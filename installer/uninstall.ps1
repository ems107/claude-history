# claude-history uninstaller.
#
# Interactive (from the install folder):
#   powershell -ExecutionPolicy Bypass -File .\uninstall.ps1
#
# From the app's Settings page the server calls it as:
#   uninstall.ps1 -Register -Root <install root> -ServerPid <pid> [-DeleteData]
# which schedules a one-shot task to do the work and returns immediately. That
# detour is required for the same reason as the updater: Task Scheduler kills
# the whole process tree of the claude-history task when the server exits.
#
# Removes the scheduled task, the Start Menu shortcut and (in -Register mode,
# running from a %TEMP% copy) the install folder itself. Local data - renames,
# pins, prices, settings, cache - is only deleted with -DeleteData / on
# confirmation. PowerShell 5.1 compatible; keep this file pure ASCII.

param(
  [string]$Root,
  [int]$ServerPid = 0,
  [switch]$DeleteData,
  [switch]$Register,
  [switch]$Yes
)

$ErrorActionPreference = 'Stop'
$taskName = 'claude-history'
$uninstallTaskName = 'claude-history-uninstall'
if (-not $Root) { $Root = $PSScriptRoot }
$logFile = Join-Path $env:TEMP 'claude-history-uninstall.log'

function Log([string]$msg) {
  "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $msg" | Add-Content -Path $logFile -Encoding ASCII
}

if ($Register) {
  # Hand the work to the Task Scheduler service so it outlives the server.
  $psArgs = @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
    '-File', ('"{0}"' -f $PSCommandPath),
    '-Root', ('"{0}"' -f $Root),
    '-ServerPid', $ServerPid,
    '-Yes'
  )
  if ($DeleteData) { $psArgs += '-DeleteData' }
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ($psArgs -join ' ')
  # AllowStartIfOnBatteries is NOT optional: without it Windows leaves the
  # task Queued on a laptop running on battery, and it would fire later when
  # the machine is plugged in.
  $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::FromMinutes(10)) `
    -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
  $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
  Register-ScheduledTask -TaskName $uninstallTaskName -Action $action -Settings $settings -Principal $principal -Force | Out-Null
  Start-ScheduledTask -TaskName $uninstallTaskName
  Log "uninstall task registered (root $Root, deleteData $DeleteData)"
  exit 0
}

if (-not $Yes) {
  $answer = 'n'
  try { $answer = Read-Host "Uninstall claude-history from $Root ? [y/N]" } catch {}
  if ($answer -notmatch '^[yY]') { Write-Host 'Cancelled.'; exit 0 }
}

Log "=== uninstalling from $Root (deleteData=$DeleteData, serverPid=$ServerPid) ==="

# Wait for the server to exit so its files are not locked.
if ($ServerPid -gt 0) {
  $deadline = (Get-Date).AddSeconds(30)
  while ((Get-Date) -lt $deadline -and (Get-Process -Id $ServerPid -ErrorAction SilentlyContinue)) {
    Start-Sleep -Milliseconds 500
  }
  if (Get-Process -Id $ServerPid -ErrorAction SilentlyContinue) {
    Log "server still alive - killing pid $ServerPid"
    & taskkill /PID $ServerPid /T /F | Out-Null
    Start-Sleep -Seconds 2
  }
}

try { Stop-ScheduledTask -TaskName $taskName -ErrorAction Stop } catch {}
try {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction Stop
  Write-Host "Scheduled task '$taskName' removed."
  Log "scheduled task removed"
} catch {
  Write-Host "Scheduled task '$taskName' was not registered."
}

$lnkPath = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\claude-history.lnk'
if (Test-Path $lnkPath) {
  Remove-Item $lnkPath -Force
  Write-Host "Start Menu shortcut removed."
  Log "shortcut removed"
}

# Local data lives OUTSIDE the install folder and survives reinstalls.
$data = Join-Path $env:LOCALAPPDATA 'claude-history'
$wipeData = [bool]$DeleteData
if (-not $Yes -and (Test-Path $data)) {
  $answer = 'n'
  try { $answer = Read-Host "Delete local data (renames, pins, prices, settings, cache) at $data ? [y/N]" } catch {}
  $wipeData = $answer -match '^[yY]'
}
if ($wipeData -and (Test-Path $data)) {
  Remove-Item $data -Recurse -Force -ErrorAction SilentlyContinue
  Write-Host "Local data deleted."
  Log "local data deleted"
} elseif (Test-Path $data) {
  Write-Host "Local data kept at $data"
}

# One-shot updater task, if a previous update left it behind.
try { Unregister-ScheduledTask -TaskName 'claude-history-update' -Confirm:$false -ErrorAction Stop } catch {}

# Remove the install folder. Only when running from a copy outside it (the
# -Register path does exactly that), and only if it really looks like one.
$runningFromRoot = $PSScriptRoot -and ($PSScriptRoot.TrimEnd('\').ToLower().StartsWith($Root.TrimEnd('\').ToLower()))
$looksLikeInstall = (Test-Path (Join-Path $Root 'versions')) -and (Test-Path (Join-Path $Root 'install.json'))
if (-not $runningFromRoot -and $looksLikeInstall) {
  Start-Sleep -Seconds 1
  Remove-Item $Root -Recurse -Force -ErrorAction SilentlyContinue
  if (Test-Path $Root) {
    Log "could not fully remove $Root"
    Write-Host "Could not fully remove $Root - delete it manually."
  } else {
    Log "install folder removed"
    Write-Host "Install folder removed."
  }
} else {
  Write-Host "Uninstalled. You can now delete this folder manually: $Root"
}

Log "=== done ==="
# The one-shot task removes itself last (allowed while it is running).
try { Unregister-ScheduledTask -TaskName $uninstallTaskName -Confirm:$false -ErrorAction Stop } catch {}
