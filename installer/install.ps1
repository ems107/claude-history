# claude-history installer.
#
# Run from the extracted release folder (no admin rights needed):
#   powershell -ExecutionPolicy Bypass -File .\install.ps1
#
# What it does:
#   - copies itself to %LOCALAPPDATA%\Programs\claude-history (so you can
#     extract the zip anywhere, e.g. Downloads, and delete it afterwards)
#   - points the `current` junction at the newest versions\v* folder
#   - registers a per-user scheduled task (runs at logon, hidden window,
#     interactive session so Resume/Explorer/VS Code launching works)
#   - creates a Start Menu shortcut that starts the task and opens the UI
#   - starts the server and opens the browser
#
# Options:
#   -InstallTo <path>  install somewhere else (must be writable without admin;
#                      Program Files is a bad fit because self-update writes here)
#   -Portable          install nothing: no copy, no task, no shortcut. Just runs
#                      the server in this console window until you press Ctrl+C.
#                      In-app updates are disabled in this mode.
#
# Idempotent: re-running repairs/upgrades an existing installation.
# Compatible with Windows PowerShell 5.1 (no pwsh required).

param(
  [string]$InstallTo,
  [switch]$Portable
)

$ErrorActionPreference = 'Stop'
$taskName = 'claude-history'
$port = 7433
$appUrl = "http://localhost:$port"
$metaUrl = "http://127.0.0.1:$port/api/meta"
$source = $PSScriptRoot

# Pick the newest versions\v* folder (numeric semver sort; prerelease
# suffixes are ignored for ordering).
function Get-NewestVersionDir([string]$base) {
  # Numeric version first; between v1.3.1 and v1.3.1-dev the release wins.
  $dirs = Get-ChildItem -Path (Join-Path $base 'versions') -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match '^v\d+\.\d+\.\d+' } |
    Sort-Object @{ Expression = { [version](($_.Name.Substring(1)) -replace '-.*$', '') } },
                @{ Expression = { if ($_.Name -match '-') { 0 } else { 1 } } } -Descending
  if (-not $dirs) { throw "No versions\v* folder found in $base - extract the full zip first." }
  return $dirs[0]
}

function Wait-PortFree([int]$p, [int]$seconds = 20) {
  for ($i = 0; $i -lt $seconds * 2; $i++) {
    if (-not (Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue)) { return $true }
    Start-Sleep -Milliseconds 500
  }
  return $false
}

# Remove Mark-of-the-Web from the extracted files (the zip was downloaded).
Get-ChildItem -Path $source -Recurse -File | Unblock-File -ErrorAction SilentlyContinue

# --- Portable mode: run from here, install nothing -------------------------
if ($Portable) {
  $version = Get-NewestVersionDir $source
  Write-Host "Running claude-history $($version.Name) in portable mode from $source"
  if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
    throw "Port $port is already in use - stop the other claude-history instance first (Task Scheduler task '$taskName')."
  }
  $node = Join-Path $version.FullName 'node\node.exe'
  $server = Join-Path $version.FullName 'server.cjs'
  $web = Join-Path $version.FullName 'web'
  $proc = Start-Process -FilePath $node -ArgumentList @("`"$server`"", '--serve-static', "`"$web`"") -NoNewWindow -PassThru
  for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 500
    try { if ((Invoke-RestMethod -Uri $metaUrl -TimeoutSec 2).version) { break } } catch {}
  }
  Write-Host "Open $appUrl - press Ctrl+C in this window to stop."
  Start-Process $appUrl
  Wait-Process -Id $proc.Id
  return
}

# --- Managed install -------------------------------------------------------
$root = if ($InstallTo) { $InstallTo } else { Join-Path $env:LOCALAPPDATA 'Programs\claude-history' }
$root = [System.IO.Path]::GetFullPath($root)
$relocating = -not ([System.IO.Path]::GetFullPath($source).TrimEnd('\') -ieq $root.TrimEnd('\'))

# Stop a previously installed instance and WAIT for it to release the port.
# Ending the task kills the wscript wrapper; the server notices its parent is
# gone and exits within a few seconds. Starting the new one before that
# happens makes it fail to bind and die silently, while the old instance is
# still answering health checks - which used to look like a good install.
# (Stopping it first also frees the files we are about to overwrite.)
try { Stop-ScheduledTask -TaskName $taskName -ErrorAction Stop } catch {}
if (-not (Wait-PortFree $port)) {
  throw "Port $port is still in use after 20s. Stop whatever is listening on it (another claude-history instance?) and run install.ps1 again."
}

if ($relocating) {
  Write-Host "Installing claude-history to $root (from $source)"
  New-Item -ItemType Directory -Force -Path (Join-Path $root 'versions') | Out-Null
  Copy-Item -Path (Join-Path $source 'versions\*') -Destination (Join-Path $root 'versions') -Recurse -Force
  foreach ($f in @('install.ps1', 'uninstall.ps1', 'launch.vbs')) {
    Copy-Item -Path (Join-Path $source $f) -Destination (Join-Path $root $f) -Force -ErrorAction SilentlyContinue
  }
} else {
  Write-Host "Installing claude-history in $root"
}

$versions = @(Get-NewestVersionDir $root)
$target = $versions[0].FullName
Write-Host "Newest version: $($versions[0].Name)"

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
  Write-Host "Installed in $root"
  if ($relocating) { Write-Host "You can delete the folder you extracted the zip into: $source" }
  Start-Process $appUrl
} elseif ($serving) {
  Write-Warning "Port $port is answering with version $serving, not the installed $expected."
  Write-Warning "Check server.log in this folder and the task state in Task Scheduler (taskschd.msc)."
} else {
  Write-Warning "The server did not answer on $metaUrl after 20s."
  Write-Warning "Check server.log in this folder and the task state in Task Scheduler (taskschd.msc)."
}
