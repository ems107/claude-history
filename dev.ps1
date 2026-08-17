# Start the claude-history DEV instance from this source checkout.
#
#   .\dev.ps1              start it (build first if web\dist is missing)
#   .\dev.ps1 -Build       rebuild the web app, then start
#   .\dev.ps1 -Restart     stop whatever is on the dev port, then start
#   .\dev.ps1 -Stop        stop the dev instance and leave
#   .\dev.ps1 -Foreground  run in this window (Ctrl+C stops it)
#   .\dev.ps1 -Seed        first run only: copy the release's cache and DATA
#                          (renames, pins, stars, prices) into the dev folder,
#                          so it opens warm and realistic. Settings are NOT
#                          copied - inheriting them would hand the dev instance
#                          the release's background jobs. Never copies back.
#
# The installed release owns port 7433 and %LOCALAPPDATA%\claude-history, and
# nothing here touches either: the dev server binds 7434 and keeps its cache,
# userdata.json, backups and logs in %LOCALAPPDATA%\claude-history-dev. Both
# read ~/.claude, and neither ever writes to it.

param(
  [switch]$Build,
  [switch]$Restart,
  [switch]$Stop,
  [switch]$Foreground,
  [switch]$Seed,
  [switch]$NoBrowser,
  [int]$Port = 7434
)

$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
$releaseData = Join-Path $env:LOCALAPPDATA 'claude-history'
$devData = Join-Path $env:LOCALAPPDATA 'claude-history-dev'

# The whole point of the split. Never bind the release's port, whatever is asked.
if ($Port -eq 7433) {
  throw "Port 7433 belongs to the installed release. The dev instance uses 7434 (-Port to pick another)."
}

$appUrl = "http://127.0.0.1:$Port"

function Get-Listener([int]$p) {
  return Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique
}

function Stop-Dev([int]$p) {
  $pids = @(Get-Listener $p)
  if (-not $pids) { return $false }
  foreach ($procId in $pids) {
    Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
    Write-Host "Stopped the dev server on $p (pid $procId)."
  }
  for ($i = 0; $i -lt 40; $i++) {
    if (-not (Get-Listener $p)) { return $true }
    Start-Sleep -Milliseconds 250
  }
  throw "Port $p is still in use after 10s."
}

if ($Stop) {
  if (-not (Stop-Dev $Port)) { Write-Host "Nothing was listening on $Port." }
  return
}

# --- Seed: one-way copy from the release's data, and only what is missing ----
if ($Seed) {
  New-Item -ItemType Directory -Force -Path $devData | Out-Null
  $srcUserdata = Join-Path $releaseData 'userdata.json'
  $dstUserdata = Join-Path $devData 'userdata.json'
  if ((Test-Path $srcUserdata) -and -not (Test-Path $dstUserdata)) {
    # Data yes, settings no. A copied `settings` block would bring the
    # release's background jobs with it - auto-reload above all - and two
    # servers spawning Claude against one 5-hour window is the exact thing the
    # split exists to prevent. Dropping the key leaves the dev defaults in
    # charge (DEV_SETTING_OVERRIDES), which are the safe ones.
    $data = Get-Content $srcUserdata -Raw | ConvertFrom-Json
    $data.PSObject.Properties.Remove('settings')
    $json = $data | ConvertTo-Json -Depth 100
    # BOM-less UTF-8: the server JSON.parses this file, and a BOM would make it
    # unreadable - it would be quarantined as corrupt on the first start.
    [System.IO.File]::WriteAllText($dstUserdata, $json, (New-Object System.Text.UTF8Encoding($false)))
    Write-Host "Seeded userdata.json from the release (renames, pins, stars and prices; settings left at the dev defaults)."
  } else {
    Write-Host "userdata.json not seeded (the dev one already exists, or the release has none)."
  }
  $srcCache = Join-Path $releaseData 'cache'
  $dstCache = Join-Path $devData 'cache'
  if ((Test-Path $srcCache) -and -not (Test-Path $dstCache)) {
    Copy-Item $srcCache $dstCache -Recurse
    Write-Host "Seeded the cache from the release (it opens warm instead of re-reading every transcript)."
  }
}

# --- Build ------------------------------------------------------------------
$dist = Join-Path $repo 'web\dist\index.html'
if ($Build -or -not (Test-Path $dist)) {
  Write-Host "Building the web app..."
  Push-Location $repo
  try {
    pnpm build
    if ($LASTEXITCODE -ne 0) { throw "pnpm build failed." }
  } finally { Pop-Location }
}

# --- Start ------------------------------------------------------------------
if ($Restart) { Stop-Dev $Port | Out-Null }
if (Get-Listener $Port) {
  Write-Host "Something is already listening on $Port. Use -Restart to replace it."
  if (-not $NoBrowser) { Start-Process $appUrl }
  return
}

# PORT reaches the server through the environment, so put back whatever this
# shell had: running this script must not change the caller's session.
$previousPort = $env:PORT
$env:PORT = "$Port"
try {
  Push-Location $repo
  try {
    if ($Foreground) {
      Write-Host "claude-history dev on $appUrl - Ctrl+C to stop."
      pnpm start
      return
    }
    Start-Process -FilePath 'pnpm' -ArgumentList 'start' -WindowStyle Hidden -WorkingDirectory $repo
  } finally { Pop-Location }
} finally {
  if ($null -eq $previousPort) { Remove-Item Env:\PORT -ErrorAction SilentlyContinue } else { $env:PORT = $previousPort }
}

# Answering is not enough: check it is the DEV instance that answered, the same
# way the installer checks the version. A stale process on the port would
# otherwise look like a good start.
$meta = $null
for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep -Milliseconds 500
  try { $meta = Invoke-RestMethod -Uri "$appUrl/api/meta" -TimeoutSec 2 } catch { $meta = $null }
  if ($meta -and $meta.devInstance) { break }
}
if (-not $meta) {
  throw "The dev server did not answer on $appUrl/api/meta after 30s. Check $devData\logs."
}
if (-not $meta.devInstance) {
  throw "Something answered on $Port but it is not a dev instance (version $($meta.version), cache $($meta.cacheDir))."
}

Write-Host "claude-history dev ($($meta.version)) on $appUrl"
Write-Host "  data:    $devData"
Write-Host "  release: untouched on http://127.0.0.1:7433"
if (-not $NoBrowser) { Start-Process $appUrl }
