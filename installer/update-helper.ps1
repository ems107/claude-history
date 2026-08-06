# claude-history update helper.
#
# Launched DETACHED by the server (from a %TEMP% copy, so it never runs from
# a folder being swapped) right before the server exits:
#   powershell -File update-helper.ps1 -Root <install root> -NewVersion vX.Y.Z -ServerPid <pid> [-Port 7433]
#
# Waits for the old server to die, points the `current` junction at the new
# version, restarts the scheduled task and health-checks the result. If the
# new version does not come up, rolls back to the previous one.
# Everything is logged to <root>\update.log. PowerShell 5.1 compatible.

param(
  [Parameter(Mandatory = $true)] [string]$Root,
  [Parameter(Mandatory = $true)] [string]$NewVersion,
  [Parameter(Mandatory = $true)] [int]$ServerPid,
  [int]$Port = 7433
)

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
  exit 1
} catch {
  Log "FATAL: $($_.Exception.Message)"
  exit 1
}
