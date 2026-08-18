# Start a RELEASE-SHAPED instance from this source checkout, on its own data.
#
#   .\preview.ps1              start it (build first if web\dist is missing)
#   .\preview.ps1 -Build       rebuild the web app, then start
#   .\preview.ps1 -Restart     stop whatever is on the preview port, then start
#   .\preview.ps1 -Stop        stop it and leave
#   .\preview.ps1 -Foreground  run in this window (Ctrl+C stops it)
#   .\preview.ps1 -Seed        first run only: copy the release's cache and DATA
#                              (renames, pins, stars, prices) so it opens warm.
#                              Settings are NEVER copied - see below.
#
# WHY THIS EXISTS, next to dev.ps1: the dev instance binds 127.0.0.1 always, so
# remote access cannot be tried on it at all. This one runs WITHOUT
# --dev-instance, so it decides its bind exactly as a release does - loopback
# until the firewall allows its port, then every interface. That is the only way
# to use the feature, or to run checks 30-36, without publishing a release.
# To reach it over the network before that rule exists, pass --host 0.0.0.0 by
# hand: the one escape hatch, and the one thing that can still make Windows ask
# for permission.
#
# Three things it must never do, and does not:
#
#  - Touch the installed release. It owns 7433 and %LOCALAPPDATA%\claude-history;
#    this binds 7435 and keeps everything in ...\claude-history-preview.
#  - Touch the dev instance on 7434.
#  - Make network calls. Without --dev-instance the DEFAULTS apply, which means
#    update polling and subscription-usage reads are ON - and usage rate-limits
#    per ACCOUNT, so a 429 earned here would blank the real release's widget.
#    Hence the settings block written below on first run: it is a safety
#    measure, not a preference, which is why it is written whether or not
#    -Seed was asked for.
#
# Like the release, it only ever READS ~/.claude.

param(
  [switch]$Build,
  [switch]$Restart,
  [switch]$Stop,
  [switch]$Foreground,
  [switch]$Seed,
  [switch]$NoBrowser,
  [int]$Port = 7435
)

$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
$releaseData = Join-Path $env:LOCALAPPDATA 'claude-history'
$previewData = Join-Path $env:LOCALAPPDATA 'claude-history-preview'

if ($Port -eq 7433) {
  throw "Port 7433 belongs to the installed release. The preview instance uses 7435 (-Port to pick another)."
}
if ($Port -eq 7434) {
  throw "Port 7434 belongs to the dev instance (dev.ps1). The preview instance uses 7435 (-Port to pick another)."
}

$appUrl = "http://127.0.0.1:$Port"

function Get-Listener([int]$p) {
  return Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique
}

function Stop-Preview([int]$p) {
  $pids = @(Get-Listener $p)
  if (-not $pids) { return $false }
  foreach ($procId in $pids) {
    Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
    Write-Host "Stopped the preview server on $p (pid $procId)."
  }
  for ($i = 0; $i -lt 40; $i++) {
    if (-not (Get-Listener $p)) { return $true }
    Start-Sleep -Milliseconds 250
  }
  throw "Port $p is still in use after 10s."
}

if ($Stop) {
  if (-not (Stop-Preview $Port)) { Write-Host "Nothing was listening on $Port." }
  return
}

# --- First run: the data folder, and the settings that keep it off the network -
New-Item -ItemType Directory -Force -Path $previewData | Out-Null
$userdataFile = Join-Path $previewData 'userdata.json'
if (-not (Test-Path $userdataFile)) {
  $data = [ordered]@{ titleOverrides = @{}; pins = @(); stars = @() }
  if ($Seed) {
    $srcUserdata = Join-Path $releaseData 'userdata.json'
    if (Test-Path $srcUserdata) {
      $src = Get-Content $srcUserdata -Raw | ConvertFrom-Json
      foreach ($key in 'titleOverrides', 'pins', 'stars', 'prices') {
        if ($src.PSObject.Properties.Name -contains $key) { $data[$key] = $src.$key }
      }
      Write-Host "Seeded userdata.json from the release (renames, pins, stars and prices)."
    }
  }
  # Never copied, always written. Everything here is a background job that would
  # otherwise run twice against one account.
  $data['settings'] = [ordered]@{
    updateAutoCheck  = $false   # a source run can never apply one
    usageWidget      = $false   # reads rate-limit per ACCOUNT, not per instance
    usageOnActivity  = $false
    usageOnInterval  = $false
    usageOnFocus     = $false
    usageOnReset     = $false
    autoReloadEnabled = $false  # spawns Claude against the same 5-hour window
  }
  # BOM-less UTF-8: the server JSON.parses this file, and a BOM would have it
  # quarantined as corrupt on the very first start.
  $json = $data | ConvertTo-Json -Depth 100
  [System.IO.File]::WriteAllText($userdataFile, $json, (New-Object System.Text.UTF8Encoding($false)))
  Write-Host "Created $userdataFile with the automatic network calls switched off."
}

if ($Seed) {
  $srcCache = Join-Path $releaseData 'cache'
  $dstCache = Join-Path $previewData 'cache'
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
if ($Restart) { Stop-Preview $Port | Out-Null }
if (Get-Listener $Port) {
  Write-Host "Something is already listening on $Port. Use -Restart to replace it."
  if (-not $NoBrowser) { Start-Process $appUrl }
  return
}

# No `pnpm start`: that script passes --dev-instance, which is the one flag this
# instance must not have. Both variables are put back afterwards, so running
# this script never changes the caller's shell.
$previousPort = $env:PORT
$previousCache = $env:CLAUDE_HISTORY_CACHE
$env:PORT = "$Port"
$env:CLAUDE_HISTORY_CACHE = Join-Path $previewData 'cache'
$serverDir = Join-Path $repo 'server'
try {
  if ($Foreground) {
    Write-Host "claude-history preview on $appUrl - Ctrl+C to stop."
    Push-Location $serverDir
    try { pnpm exec tsx src/main.ts --serve-static ../web/dist } finally { Pop-Location }
    return
  }
  Start-Process -FilePath 'pnpm' `
    -ArgumentList 'exec', 'tsx', 'src/main.ts', '--serve-static', '../web/dist' `
    -WindowStyle Hidden -WorkingDirectory $serverDir
} finally {
  if ($null -eq $previousPort) { Remove-Item Env:\PORT -ErrorAction SilentlyContinue } else { $env:PORT = $previousPort }
  if ($null -eq $previousCache) { Remove-Item Env:\CLAUDE_HISTORY_CACHE -ErrorAction SilentlyContinue } else { $env:CLAUDE_HISTORY_CACHE = $previousCache }
}

# Answering is not enough. Check WHICH instance answered: the danger here is the
# mirror of dev.ps1's - a preview run that picked up the release's data folder
# would look perfectly healthy while writing to it.
$meta = $null
for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep -Milliseconds 500
  try { $meta = Invoke-RestMethod -Uri "$appUrl/api/meta" -TimeoutSec 2 } catch { $meta = $null }
  if ($meta) { break }
}
if (-not $meta) {
  throw "The preview server did not answer on $appUrl/api/meta after 30s. Check $previewData\logs."
}
if ($meta.devInstance) {
  throw "Something answered on $Port but it is a DEV instance - it would bind 127.0.0.1 only and remote access could not be tried."
}
if ($meta.cacheDir -notlike "$previewData*") {
  throw "The server on $Port is using $($meta.cacheDir), which is NOT the preview folder. Stop it before it writes there."
}

Write-Host ""
Write-Host "claude-history preview ($($meta.version)) on $appUrl"
Write-Host "  data:    $previewData"
Write-Host "  release: untouched on http://127.0.0.1:7433   dev: untouched on http://127.0.0.1:7434"

# The server already works these two out for its own Settings panel, so ask it
# rather than repeat the logic here.
try {
  $fw = Invoke-RestMethod -Uri "$appUrl/api/firewall" -TimeoutSec 25
  Write-Host ""
  if ($fw.addresses) {
    Write-Host "From another machine: " -NoNewline
    Write-Host (($fw.addresses | ForEach-Object { "http://${_}:$Port" }) -join '  ')
  }
  $ruleState = if ($null -eq $fw.ruleExists) { 'could not be read' } elseif ($fw.ruleExists) { 'open' } else { 'CLOSED - open it from Settings' }
  Write-Host "Windows Firewall, port ${Port}: $ruleState"
  if ($fw.activeProfiles -contains 'Public') {
    Write-Host "This machine is on a network Windows calls Public, where the rule will not apply." -ForegroundColor Yellow
  }
} catch {
  Write-Host "(could not read the firewall state: $_)"
}

Write-Host ""
Write-Host "Next: open $appUrl -> Settings -> Remote access, tick it and set a username and password."
Write-Host "Note: not a managed install, so Update / Uninstall / Open install folder stay disabled here."
if (-not $NoBrowser) { Start-Process $appUrl }
