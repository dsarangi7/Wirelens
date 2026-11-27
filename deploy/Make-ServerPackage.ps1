<#
  Build the Wirelens server package (run on the development PC, in PowerShell, from anywhere).

    .\deploy\Make-ServerPackage.ps1 [-ServerUrl http://<server>] [-Out <folder>]

  Output: dist\Wirelens-server-package.zip (dist\ is git-ignored), containing
    SERVER.md, nginx-wirelens.conf, Update-Wirelens.ps1   (install / update guide and scripts)
    Wirelens-data.zip                                     (projects\: racks.local.json + rack models, CONFIDENTIAL)
  The code itself is not in the package: the server pulls it from Gitea.
#>
param(
  [string]$ServerUrl = 'http://<server>',
  [string]$Out
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
if (-not $Out) { $Out = Join-Path $root 'dist' }
$stage = Join-Path $Out 'stage'
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Force (Join-Path $stage 'data\projects') | Out-Null

# project data: the picker list + every rack file it points to, plus its model (.glb) and parts list
$list = Get-Content (Join-Path $root 'projects\racks.local.json') -Raw | ConvertFrom-Json
Copy-Item (Join-Path $root 'projects\racks.local.json') (Join-Path $stage 'data\projects')
$files = New-Object System.Collections.Generic.HashSet[string]
foreach ($r in $list) {
  $rel = $r.url -replace '/', '\'
  $dir = Split-Path $rel -Parent
  Get-ChildItem (Join-Path $root $dir) -File | Where-Object { $_.Extension -in '.json', '.glb' } |
    ForEach-Object { [void]$files.Add((Join-Path $dir $_.Name)) }
}
foreach ($f in $files) {
  $dst = Join-Path $stage ('data\' + $f)
  New-Item -ItemType Directory -Force (Split-Path $dst -Parent) | Out-Null
  Copy-Item (Join-Path $root $f) $dst
}
$dataZip = Join-Path $stage 'Wirelens-data.zip'
Compress-Archive -Path (Join-Path $stage 'data\projects') -DestinationPath $dataZip
Remove-Item (Join-Path $stage 'data') -Recurse -Force

# guide + scripts
Copy-Item (Join-Path $PSScriptRoot 'nginx-wirelens.conf'), (Join-Path $PSScriptRoot 'Update-Wirelens.ps1') $stage
$gitea = (git -C $root remote get-url origin) 2>$null
if (-not $gitea) { $gitea = '<Gitea URL of Wirelens>' }
$commit = (git -C $root log --oneline -1) 2>$null
(Get-Content (Join-Path $PSScriptRoot 'SERVER.md') -Raw).Replace('{{SERVER}}', $ServerUrl).Replace('{{GITEA}}', $gitea).
  Replace('{{BUILT}}', (Get-Date -Format 'yyyy-MM-dd HH:mm') + ', code at ' + $commit + ', ' + $files.Count + ' data files') |
  Set-Content (Join-Path $stage 'SERVER.md') -Encoding utf8

$zip = Join-Path $Out 'Wirelens-server-package.zip'
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip
Remove-Item $stage -Recurse -Force
$git = git -C $root status --porcelain -- index.html js assets
if ($git) { Write-Warning 'index.html / js / assets have uncommitted changes: commit and push them, or the server (git pull) will not get them.' }
Write-Host ("Package: {0} ({1:N1} MB, {2} data files)" -f $zip, ((Get-Item $zip).Length / 1MB), $files.Count)
