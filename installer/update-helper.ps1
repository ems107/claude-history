# claude-history update helper. Runs from a %TEMP% copy, never from a folder
# being swapped. Two modes:
#
#   -Register : registers and starts a one-shot scheduled task that runs this
#               same script in work mode, then exits. The server calls this
#               SYNCHRONOUSLY before quitting.
#   (default) : does the update - waits for the old server to die, points the
#               `current` junction at the new version, restarts the app task,
#               health-checks it and rolls back if it does not come up.
#
# -RestartOnly does the same dance without the version change: wait for the old
# server, start the task, health-check what comes back. It exists because the
# bind address is decided at startup and cannot change while the server runs
# (server/src/core/bind.ts), so switching remote access on or off needs the
# process to listen again - and the server cannot restart itself for the reason
# in the next paragraph. Its own task name, so a restart from Settings cannot
# collide with an update in flight.
#
# Why the detour: the server runs inside the `claude-history` scheduled task,
# and Task Scheduler terminates that task's whole process tree when the task
# ends. A helper spawned by the server (even detached) dies with it. Having
# the Task Scheduler service start the helper puts it outside that tree.
#
# Everything is logged to <root>\update.log, which is ALSO the second half of
# the app's own log: the server imports these lines under the `update-helper`
# source on its next start, so the whole update reads as one timeline in the
# log viewer. Hence the level tag - keep the "yyyy-MM-dd HH:mm:ss  [lvl] msg"
# shape, the importer parses it. PowerShell 5.1 compatible, pure ASCII.

param(
  [Parameter(Mandatory = $true)] [string]$Root,
  [string]$NewVersion,
  [Parameter(Mandatory = $true)] [int]$ServerPid,
  [int]$Port = 7433,
  [switch]$Register,
  [switch]$RestartOnly
)

if ($RestartOnly) { $updateTaskName = 'claude-history-restart' } else { $updateTaskName = 'claude-history-update' }
if (-not $RestartOnly -and -not $NewVersion) { throw '-NewVersion is required unless -RestartOnly is given.' }

$ErrorActionPreference = 'Stop'
$logFile = Join-Path $Root 'update.log'
# The .NET call in Log() resolves a relative path against the PROCESS working
# directory, which is not PowerShell's location. $Root arrives absolute from the
# server; this only makes sure of it.
if (-not [System.IO.Path]::IsPathRooted($logFile)) {
  $logFile = Join-Path (Get-Location).Path $logFile
}
# BOM-less UTF-8, written through .NET because neither Add-Content encoding
# will do. -Encoding ASCII replaced every non-ASCII character with a literal
# "?", and on an install under a profile whose name is not ASCII that is nearly
# every line this file has: the install root, the junction targets, the script
# path, the user name. -Encoding UTF8 in PowerShell 5.1 writes a BOM at the head
# of the file, which the importer would then read as part of the first record.
# The SCRIPT stays pure ASCII (package.mjs enforces it); its output does not.
$logEncoding = New-Object System.Text.UTF8Encoding($false)
# One record per line, always: exception messages arrive with trailing newlines
# and .NET ones can be several lines long, which would break both a person
# reading this and the importer that copies these lines into the app's log.
function Log([string]$msg, [string]$level = 'info') {
  $flat = ($msg -replace "`r?`n", ' ').Trim()
  $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  [$level] $flat"
  [System.IO.File]::AppendAllText($logFile, ($line + [Environment]::NewLine), $logEncoding)
}

function Get-MetaVersion {
  try {
    return (Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/meta" -TimeoutSec 3).version
  } catch {
    return $null
  }
}

# Poll /api/meta for a specific version, reporting what actually answered along
# the way: "it did not come up" and "the old one is still serving" are
# different failures and only the log can tell them apart afterwards.
#
# Bounded by the CLOCK, not by a count of iterations. Counting was wrong by a
# factor of five: with nothing listening, each Invoke-RestMethod costs about
# two seconds before it gives up, so a "45s" health check really took nearly
# four minutes - four minutes with the app down before the rollback started.
function Wait-ForVersion([string]$expected, [int]$seconds) {
  $started = Get-Date
  $deadline = $started.AddSeconds($seconds)
  $seen = @{}
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 500
    $got = Get-MetaVersion
    if ($got -eq $expected) {
      Log "port $Port is serving $expected after $([int]((Get-Date) - $started).TotalSeconds)s"
      return $true
    }
    $key = 'nothing'
    if ($got) { $key = $got }
    if (-not $seen.ContainsKey($key)) {
      $seen[$key] = $true
      if ($got) { Log "port $Port answers with $got, waiting for $expected" }
      else { Log "port $Port is not answering yet, waiting for $expected" }
    }
  }
  Log "gave up waiting for $expected on port $Port after ${seconds}s" 'warn'
  return $false
}

if ($Register) {
  # Hand this same script to the Task Scheduler service so it runs outside
  # the app task's process tree, then return control to the dying server.
  try {
    $parts = @(
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
      '-File', ('"{0}"' -f $PSCommandPath),
      '-Root', ('"{0}"' -f $Root),
      '-ServerPid', $ServerPid,
      '-Port', $Port
    )
    if ($RestartOnly) { $parts += '-RestartOnly' } else { $parts += @('-NewVersion', $NewVersion) }
    $psArgs = $parts -join ' '
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $psArgs
    $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::FromMinutes(10)) `
      -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
    Register-ScheduledTask -TaskName $updateTaskName -Action $action -Settings $settings -Principal $principal -Force | Out-Null
    Start-ScheduledTask -TaskName $updateTaskName
    if ($RestartOnly) { $what = 'a restart' } else { $what = $NewVersion }
    Log "task '$updateTaskName' registered and started for $what (from $PSCommandPath)"
    exit 0
  } catch {
    Log "FATAL registering task '$updateTaskName': $($_.Exception.Message)" 'error'
    exit 1
  }
}

# The one-shot task that is running this script right now; removing it while
# it runs is allowed and keeps Task Scheduler tidy.
function Remove-UpdateTask {
  try {
    Unregister-ScheduledTask -TaskName $updateTaskName -Confirm:$false -ErrorAction Stop
    Log "one-shot task '$updateTaskName' unregistered"
  } catch {
    Log "could not unregister '$updateTaskName': $($_.Exception.Message)" 'warn'
  }
}

# Task Scheduler ignores Start-ScheduledTask on a task that is still Running,
# and the outgoing server keeps its task Running for a moment after node
# exits. Starting into that window looks like success and silently leaves
# nothing serving, so wait for Ready first.
function Wait-ForTaskReady([string]$name, [int]$seconds) {
  $started = Get-Date
  $deadline = $started.AddSeconds($seconds)
  $first = $true
  while ($true) {
    try {
      $state = (Get-ScheduledTask -TaskName $name -ErrorAction Stop).State
    } catch {
      Log "task '$name' cannot be read: $($_.Exception.Message)" 'error'
      return $false
    }
    if ($state -ne 'Running') {
      if (-not $first) { Log "task '$name' is $state after $([int]((Get-Date) - $started).TotalSeconds)s" }
      return $true
    }
    $first = $false
    if ((Get-Date) -ge $deadline) { break }
    Start-Sleep -Milliseconds 500
  }
  Log "task '$name' is still Running after ${seconds}s - starting it anyway" 'warn'
  return $false
}

function Start-AppTask([string]$name) {
  Wait-ForTaskReady $name 20 | Out-Null
  try {
    Start-ScheduledTask -TaskName $name -ErrorAction Stop
  } catch {
    Log "Start-ScheduledTask '$name' failed: $($_.Exception.Message)" 'error'
    return
  }
  Start-Sleep -Milliseconds 500
  try {
    $info = Get-ScheduledTaskInfo -TaskName $name -ErrorAction Stop
    Log "task '$name' started (state $((Get-ScheduledTask -TaskName $name).State), last result $($info.LastTaskResult))"
  } catch {
    Log "task '$name' started, state unreadable: $($_.Exception.Message)" 'warn'
  }
}

$sw = [Diagnostics.Stopwatch]::StartNew()
try {
  if ($RestartOnly) { $job = 'restart' } else { $job = "update to $NewVersion" }
  Log "=== $job starting (helper pid $PID, old server pid $ServerPid, port $Port) ==="
  Log "environment: PowerShell $($PSVersionTable.PSVersion), user $env:USERNAME, root $Root, script $PSCommandPath"

  $taskName = 'claude-history'
  try {
    $taskName = (Get-Content (Join-Path $Root 'install.json') -Raw | ConvertFrom-Json).taskName
    Log "app task name from install.json: $taskName"
  } catch {
    Log "install.json unreadable ($($_.Exception.Message)) - assuming task '$taskName'" 'warn'
  }

  # 1. Wait for the old server to exit; force-kill as a last resort.
  $deadline = (Get-Date).AddSeconds(30)
  while ((Get-Date) -lt $deadline -and (Get-Process -Id $ServerPid -ErrorAction SilentlyContinue)) {
    Start-Sleep -Milliseconds 500
  }
  if (Get-Process -Id $ServerPid -ErrorAction SilentlyContinue) {
    Log "old server (pid $ServerPid) still alive after 30s - killing it" 'warn'
    & taskkill /PID $ServerPid /T /F | Out-Null
    Start-Sleep -Seconds 1
  } else {
    Log "old server (pid $ServerPid) is gone after $([int]$sw.Elapsed.TotalSeconds)s"
  }

  # A restart stops here: no version changes, so there is nothing to swap and
  # nothing to prune. The same build comes back up, and the only thing that is
  # different about it is the bind it decides on the way (remote access on or
  # off), which is the reason this mode exists at all.
  if ($RestartOnly) {
    $currentLink = Join-Path $Root 'current'
    $target = (Get-Item $currentLink).Target
    if ($target -is [array]) { $target = $target[0] }
    $expected = (Split-Path $target -Leaf).TrimStart('v')
    Log "restarting $expected from $target"
    Start-AppTask $taskName
    if (Wait-ForVersion $expected 45) {
      Log "=== restart finished OK in $([int]$sw.Elapsed.TotalSeconds)s ==="
      Remove-UpdateTask
      exit 0
    }
    Log "=== restart FAILED - nothing is serving $expected on port $Port. Start it from the Start Menu shortcut or Task Scheduler ('$taskName' -> Run) ===" 'error'
    Remove-UpdateTask
    exit 1
  }

  # 2. Swap the junction (remember the old target for rollback).
  $current = Join-Path $Root 'current'
  $oldTarget = (Get-Item $current).Target
  if ($oldTarget -is [array]) { $oldTarget = $oldTarget[0] }
  $newTarget = Join-Path (Join-Path $Root 'versions') $NewVersion
  if (-not (Test-Path (Join-Path $newTarget 'server.cjs'))) { throw "staged version incomplete: $newTarget" }
  (Get-Item $current).Delete()
  New-Item -ItemType Junction -Path $current -Target $newTarget | Out-Null
  Log "junction 'current' now points at $newTarget (was $oldTarget)"

  # 3. Restart and verify the new version answers.
  $expected = $NewVersion.TrimStart('v')
  Start-AppTask $taskName
  if (Wait-ForVersion $expected 45) {
    Log "update OK - $expected is serving after $([int]$sw.Elapsed.TotalSeconds)s"

    # Refresh the root-level scripts from the new version (updates only
    # extract versions\, so these would otherwise stay at install-time).
    foreach ($f in @('install.ps1', 'uninstall.ps1', 'launch.vbs')) {
      $src = Join-Path $newTarget $f
      if (Test-Path $src) {
        try {
          Copy-Item $src (Join-Path $Root $f) -Force -ErrorAction Stop
          Log "refreshed $f from $NewVersion"
        } catch {
          Log "could not refresh ${f}: $($_.Exception.Message)" 'warn'
        }
      }
    }

    # 4. Prune version folders, keeping the 3 newest releases (never the
    # active one). Anything not named vX.Y.Z - a local vdev build, a leftover
    # - is not a release and goes too, which is worth saying out loud.
    $versionsDir = Join-Path $Root 'versions'
    $keep = Get-ChildItem $versionsDir -Directory |
      Where-Object { $_.Name -match '^v\d+\.\d+\.\d+' } |
      Sort-Object { [version](($_.Name.Substring(1)) -replace '-.*$', '') } -Descending |
      Select-Object -First 3
    Log "keeping versions: $(($keep | ForEach-Object { $_.Name }) -join ', ')"
    Get-ChildItem $versionsDir -Directory | Where-Object {
      $_.FullName -ne $newTarget -and $keep.FullName -notcontains $_.FullName
    } | ForEach-Object {
      try {
        Remove-Item $_.FullName -Recurse -Force -ErrorAction Stop
        Log "pruned $($_.Name)"
      } catch {
        Log "could not prune $($_.Name): $($_.Exception.Message)" 'warn'
      }
    }
    Log "=== update to $NewVersion finished OK in $([int]$sw.Elapsed.TotalSeconds)s ==="
    Remove-UpdateTask
    exit 0
  }

  # 5. Rollback.
  Log "$expected did not answer within 45s - rolling back to $oldTarget" 'error'
  try {
    Stop-ScheduledTask -TaskName $taskName -ErrorAction Stop
    Log "stopped task '$taskName' before rolling back"
  } catch {
    Log "could not stop '$taskName' before rolling back: $($_.Exception.Message)" 'warn'
  }
  Start-Sleep -Seconds 4
  (Get-Item $current).Delete()
  New-Item -ItemType Junction -Path $current -Target $oldTarget | Out-Null
  Log "junction 'current' restored to $oldTarget"
  Start-AppTask $taskName
  if (Wait-ForVersion (Split-Path $oldTarget -Leaf).TrimStart('v') 30) {
    Log "=== rollback OK - the previous version is serving again (update to $NewVersion FAILED) ===" 'error'
  } else {
    Log "=== rollback FAILED - nothing is serving on port $Port. Start it from the Start Menu shortcut or Task Scheduler ('$taskName' -> Run) ===" 'error'
  }
  Remove-UpdateTask
  exit 1
} catch {
  Log "FATAL at line $($_.InvocationInfo.ScriptLineNumber): $($_.Exception.Message)" 'error'
  if ($_.ScriptStackTrace) { Log "stack: $($_.ScriptStackTrace -replace "`r?`n", ' | ')" 'error' }
  Remove-UpdateTask
  exit 1
}
