<#
  Update Wirelens on the production server (run ON the server, in PowerShell).

    .\Update-Wirelens.ps1                         # pull the latest code from Gitea
    .\Update-Wirelens.ps1 -DataZip <path>.zip     # ... and replace the project data (projects\) from a package

  Code (index.html, js\, assets\) comes from Gitea with git pull.
  Project data (projects\: racks.local.json + the rack models) is NOT in git (confidential): it comes from the
  server package zip made with deploy\Make-ServerPackage.ps1. git pull never touches projects\.
  nginx serves the files straight from disk: no reload needed after an update.
#>
param(
  [string]$Path = 'C:\apps\Wirelens',
  [string]$DataZip
)
$ErrorActionPreference = 'Stop'

if (-not (Test-Path (Join-Path $Path '.git'))) {
  throw "$Path is not a git clone. First install: git clone <Gitea URL of Wirelens> $Path   (see SERVER.md)"
}

Write-Host "== Pulling the latest code from Gitea into $Path"
git -C $Path pull --ff-only
if ($LASTEXITCODE -ne 0) { throw 'git pull failed (sign-in to Gitea, or local edits on the server: run  git -C ' + $Path + ' status)' }
git -C $Path log --oneline -1

if ($DataZip) {
  if (-not (Test-Path $DataZip)) { throw "Data zip not found: $DataZip" }
  $tmp = Join-Path $env:TEMP ('wirelens-data-' + [guid]::NewGuid())
  Write-Host "== Unpacking project data from $DataZip"
  Expand-Archive -Path $DataZip -DestinationPath $tmp
  $src = Join-Path $tmp 'projects'
  if (-not (Test-Path (Join-Path $src 'racks.local.json'))) { Remove-Item $tmp -Recurse -Force; throw 'The zip has no projects\racks.local.json: is it a Wirelens server package?' }
  robocopy $src (Join-Path $Path 'projects') /MIR /NFL /NDL /NJH /NP | Out-Host
  $rc = $LASTEXITCODE
  Remove-Item $tmp -Recurse -Force
  if ($rc -ge 8) { throw "Copying the project data failed (robocopy $rc)" }
}

Write-Host '== Check'
$need = 'index.html', 'js\guide3d.js', 'js\guide-data.js', 'js\racks.js', 'assets\guide\racks.json', 'projects\racks.local.json'
$missing = $need | Where-Object { -not (Test-Path (Join-Path $Path $_)) }
if ($missing) { throw ('Missing: ' + ($missing -join ', ')) }
$racks = Get-Content (Join-Path $Path 'projects\racks.local.json') -Raw | ConvertFrom-Json
$bad = $racks | Where-Object { -not (Test-Path (Join-Path $Path ($_.url -replace '/', '\'))) }
if ($bad) { throw ('Rack files missing for: ' + (($bad | ForEach-Object id) -join ', ')) }
Write-Host ("OK: {0} project racks, code at {1}" -f @($racks).Count, (git -C $Path log --oneline -1))
exit 0
