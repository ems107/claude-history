# claude-history uninstaller.
#
#   powershell -ExecutionPolicy Bypass -File .\uninstall.ps1
#
# Removes the scheduled task and the Start Menu shortcut. Local data
# (title renames, pins, prices, cache) is only deleted if you confirm.
# Compatible with Windows PowerShell 5.1.

$ErrorActionPreference = 'Stop'
$taskName = 'claude-history'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

try {
  Stop-ScheduledTask -TaskName $taskName -ErrorAction Stop
} catch {}
try {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction Stop
  Write-Host "Scheduled task '$taskName' removed."
} catch {
  Write-Host "Scheduled task '$taskName' was not registered."
}

$lnkPath = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\claude-history.lnk'
if (Test-Path $lnkPath) {
  Remove-Item $lnkPath -Force
  Write-Host "Start Menu shortcut removed."
}

Remove-Item (Join-Path $root 'install.json') -Force -ErrorAction SilentlyContinue

# Local data lives OUTSIDE the install folder and survives reinstalls.
$data = Join-Path $env:LOCALAPPDATA 'claude-history'
if (Test-Path $data) {
  # Default to keeping the data when there is no interactive console.
  $answer = 'n'
  try { $answer = Read-Host "Delete local data (title renames, pins, prices, cache) at $data ? [y/N]" } catch {}
  if ($answer -match '^[yY]') {
    Remove-Item $data -Recurse -Force
    Write-Host "Local data deleted."
  } else {
    Write-Host "Local data kept."
  }
}

Write-Host "Uninstalled. You can now delete this folder manually: $root"
