# claude-history installer.
#
# Run from the extracted release folder (no admin rights needed):
#   powershell -ExecutionPolicy Bypass -File .\install.ps1
#
# What it does:
#   - points the `current` junction at the newest versions\v* folder
#   - registers a per-user scheduled task (runs at logon, hidden window,
#     interactive session so Resume/Explorer/VS Code launching works)
#   - creates a Start Menu shortcut that starts the task and opens the UI
#   - starts the server and opens the browser
#
# Idempotent: re-running repairs/updates the installation in place.
# Compatible with Windows PowerShell 5.1 (no pwsh required).

$ErrorActionPreference = 'Stop'
$taskName = 'claude-history'
$port = 7433
$appUrl = "http://localhost:$port"
$metaUrl = "http://127.0.0.1:$port/api/meta"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "Installing claude-history from $root"

# Remove Mark-of-the-Web from the extracted files (the zip was downloaded).
Get-ChildItem -Path $root -Recurse -File | Unblock-File -ErrorAction SilentlyContinue

# Pick the newest versions\v* folder (numeric semver sort; prerelease
# suffixes are ignored for ordering).
$versions = Get-ChildItem -Path (Join-Path $root 'versions') -Directory -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -match '^v\d+\.\d+\.\d+' } |
  Sort-Object { [version](($_.Name.Substring(1)) -replace '-.*$', '') } -Descending
if (-not $versions) { throw "No versions\v* folder found next to install.ps1 - extract the full zip first." }
$target = $versions[0].FullName
Write-Host "Newest version: $($versions[0].Name)"

# Stop a previously installed instance and WAIT for it to release the port.
# Ending the task kills the wscript wrapper; the server notices its parent is
# gone and exits within a few seconds. Starting the new one before that
# happens makes it fail to bind and die silently, while the old instance is
# still answering health checks - which used to look like a good install.
try { Stop-ScheduledTask -TaskName $taskName -ErrorAction Stop } catch {}
$portFree = $false
for ($i = 0; $i -lt 40; $i++) {
  if (-not (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)) { $portFree = $true; break }
  Start-Sleep -Milliseconds 500
}
if (-not $portFree) {
  throw "Port $port is still in use after 20s. Stop whatever is listening on it (another claude-history instance?) and run install.ps1 again."
}

# current -> junction -> newest version. Junctions need no admin rights.
$current = Join-Path $root 'current'
if (Test-Path $current) {
  # Deleting a junction via DirectoryInfo removes the reparse point only,
  # never the target's contents.
  (Get-Item $current).Delete()
}
New-Item -ItemType Junction -Path $current -Target $target | Out-Null

# Scheduled task: at-logon, current user, interactive, no execution time
# limit (the Windows default silently kills tasks after 72 hours).
$vbs = Join-Path $current 'start-hidden.vbs'
$action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument ('//B "{0}"' -f $vbs) -WorkingDirectory $current
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
  -Principal $principal -Settings $settings -Force | Out-Null
Write-Host "Scheduled task '$taskName' registered (starts at logon)."

# Marker consumed by the in-app updater to detect an installed instance.
@{ taskName = $taskName; root = $root; installedAt = (Get-Date).ToString('o') } |
  ConvertTo-Json | Set-Content -Path (Join-Path $root 'install.json') -Encoding UTF8

# Start Menu shortcut -> launch.vbs (starts the task if needed, opens the UI).
$lnkPath = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\claude-history.lnk'
$ws = New-Object -ComObject WScript.Shell
$lnk = $ws.CreateShortcut($lnkPath)
$lnk.TargetPath = 'wscript.exe'
$lnk.Arguments = '"{0}"' -f (Join-Path $root 'launch.vbs')
$lnk.WorkingDirectory = $root
$lnk.IconLocation = (Join-Path $current 'node\node.exe') + ',0'
$lnk.Description = 'claude-history - browse all your Claude Code conversations'
$lnk.Save()
Write-Host "Start Menu shortcut created."

# Start now and confirm the version that answers is the one just installed
# (a stale instance answering would otherwise look like success).
Start-ScheduledTask -TaskName $taskName
$expected = $versions[0].Name.TrimStart('v')
$serving = $null
for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep -Milliseconds 500
  try { $serving = (Invoke-RestMethod -Uri $metaUrl -TimeoutSec 2).version } catch {}
  if ($serving -eq $expected) { break }
}
if ($serving -eq $expected) {
  Write-Host "claude-history $serving is running - opening $appUrl"
  Start-Process $appUrl
} elseif ($serving) {
  Write-Warning "Port $port is answering with version $serving, not the installed $expected."
  Write-Warning "Check server.log in this folder and the task state in Task Scheduler (taskschd.msc)."
} else {
  Write-Warning "The server did not answer on $metaUrl after 20s."
  Write-Warning "Check server.log in this folder and the task state in Task Scheduler (taskschd.msc)."
}
