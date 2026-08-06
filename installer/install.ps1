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
$appUrl = 'http://localhost:7433'
$healthUrl = 'http://127.0.0.1:7433/api/health'
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

# Stop a previously installed instance before touching the junction.
try { Stop-ScheduledTask -TaskName $taskName -ErrorAction Stop } catch {}

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

# Start now and open the browser.
Start-ScheduledTask -TaskName $taskName
$ok = $false
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Milliseconds 500
  try {
    $r = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 2
    if ($r.StatusCode -eq 200) { $ok = $true; break }
  } catch {}
}
if ($ok) {
  Write-Host "claude-history is running - opening $appUrl"
  Start-Process $appUrl
} else {
  Write-Warning "The server did not answer on $healthUrl after 15s."
  Write-Warning "Check the task state in Task Scheduler (taskschd.msc) and that port 7433 is free."
}
