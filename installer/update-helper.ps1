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
# Why the detour: the server runs inside the `claude-history` scheduled task,
# and Task Scheduler terminates that task's whole process tree when the task
# ends. A helper spawned by the server (even detached) dies with it. Having
# the Task Scheduler service start the helper puts it outside that tree.
#
# Everything is logged to <root>\update.log. PowerShell 5.1 compatible.

param(
  [Parameter(Mandatory = $true)] [string]$Root,
  [Parameter(Mandatory = $true)] [string]$NewVersion,
  [Parameter(Mandatory = $true)] [int]$ServerPid,
  [int]$Port = 7433,
  [switch]$Register
)

$updateTaskName = 'claude-history-update'

$ErrorActionPreference = 'Stop'
$logFile = Join-Path $Root 'update.log'
function Log([string]$msg) {
  "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $msg" | Add-Content -Path $logFile -Encoding ASCII
}

function Get-MetaVersion {
  try {
    return (Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/meta" -TimeoutSec 3).version
  } catch {
    return $null
  }
}

function Wait-ForVersion([string]$expected, [int]$seconds) {
  for ($i = 0; $i -lt $seconds * 2; $i++) {
    Start-Sleep -Milliseconds 500
    if ((Get-MetaVersion) -eq $expected) { return $true }
  }
  return $false
}

if ($Register) {
  # Hand this same script to the Task Scheduler service so it runs outside
  # the app task's process tree, then return control to the dying server.
  try {
    $psArgs = @(
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
      '-File', ('"{0}"' -f $PSCommandPath),
      '-Root', ('"{0}"' -f $Root),
      '-NewVersion', $NewVersion,
      '-ServerPid', $ServerPid,
      '-Port', $Port
    ) -join ' '
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $psArgs
    $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::FromMinutes(10)) `
      -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
    Register-ScheduledTask -TaskName $updateTaskName -Action $action -Settings $settings -Principal $principal -Force | Out-Null
    Start-ScheduledTask -TaskName $updateTaskName
    Log "update task registered and started for $NewVersion"
    exit 0
  } catch {
    Log "FATAL registering update task: $($_.Exception.Message)"
    exit 1
  }
}

# The one-shot task that is running this script right now; removing it while
# it runs is allowed and keeps Task Scheduler tidy.
function Remove-UpdateTask {
  try { Unregister-ScheduledTask -TaskName $updateTaskName -Confirm:$false -ErrorAction Stop } catch {}
}

try {
  Log "=== update to $NewVersion starting (old server pid $ServerPid) ==="

  $taskName = 'claude-history'
  try { $taskName = (Get-Content (Join-Path $Root 'install.json') -Raw | ConvertFrom-Json).taskName } catch {}

  # 1. Wait for the old server to exit; force-kill as a last resort.
  $deadline = (Get-Date).AddSeconds(30)
  while ((Get-Date) -lt $deadline -and (Get-Process -Id $ServerPid -ErrorAction SilentlyContinue)) {
    Start-Sleep -Milliseconds 500
  }
  if (Get-Process -Id $ServerPid -ErrorAction SilentlyContinue) {
    Log "old server still alive after 30s - killing pid $ServerPid"
    & taskkill /PID $ServerPid /T /F | Out-Null
    Start-Sleep -Seconds 1
  }

  # 2. Swap the junction (remember the old target for rollback).
  $current = Join-Path $Root 'current'
  $oldTarget = (Get-Item $current).Target
  if ($oldTarget -is [array]) { $oldTarget = $oldTarget[0] }
  $newTarget = Join-Path (Join-Path $Root 'versions') $NewVersion
  if (-not (Test-Path (Join-Path $newTarget 'server.cjs'))) { throw "staged version incomplete: $newTarget" }
  (Get-Item $current).Delete()
  New-Item -ItemType Junction -Path $current -Target $newTarget | Out-Null
  Log "junction now points at $newTarget (was $oldTarget)"

  # 3. Restart and verify the new version answers.
  Start-ScheduledTask -TaskName $taskName
  $expected = $NewVersion.TrimStart('v')
  if (Wait-ForVersion $expected 45) {
    Log "update OK - $expected is serving"

    # Refresh the root-level scripts from the new version (updates only
    # extract versions\, so these would otherwise stay at install-time).
    foreach ($f in @('install.ps1', 'uninstall.ps1', 'launch.vbs')) {
      $src = Join-Path $newTarget $f
      if (Test-Path $src) { Copy-Item $src (Join-Path $Root $f) -Force -ErrorAction SilentlyContinue }
    }

    # 4. Prune old version folders, keeping the 3 newest (never the active one).
    $keep = Get-ChildItem (Join-Path $Root 'versions') -Directory |
      Where-Object { $_.Name -match '^v\d+\.\d+\.\d+' } |
      Sort-Object { [version](($_.Name.Substring(1)) -replace '-.*$', '') } -Descending |
      Select-Object -First 3
    Get-ChildItem (Join-Path $Root 'versions') -Directory | Where-Object {
      $_.FullName -ne $newTarget -and $keep.FullName -notcontains $_.FullName
    } | ForEach-Object {
      Log "pruning old version $($_.Name)"
      Remove-Item $_.FullName -Recurse -Force
    }
    Remove-UpdateTask
    exit 0
  }

  # 5. Rollback.
  Log "new version did not answer within 45s - rolling back to $oldTarget"
  try { Stop-ScheduledTask -TaskName $taskName } catch {}
  Start-Sleep -Seconds 4
  (Get-Item $current).Delete()
  New-Item -ItemType Junction -Path $current -Target $oldTarget | Out-Null
  Start-ScheduledTask -TaskName $taskName
  if (Wait-ForVersion (Split-Path $oldTarget -Leaf).TrimStart('v') 30) {
    Log "rollback OK - previous version is serving again"
  } else {
    Log "rollback: previous version did not answer either - start it manually (Task Scheduler or the Start Menu shortcut)"
  }
  Remove-UpdateTask
  exit 1
} catch {
  Log "FATAL: $($_.Exception.Message)"
  Remove-UpdateTask
  exit 1
}
