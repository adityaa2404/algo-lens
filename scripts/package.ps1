# Build a clean Chrome Web Store upload zip.
#
# Usage (from repo root):
#   pwsh scripts/package.ps1
# Produces: dist/algolens-<version>.zip
#
# Only files Chrome actually needs are included; docs, backend, and tooling
# are excluded.

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root

$manifest = Get-Content "manifest.json" -Raw | ConvertFrom-Json
$version = $manifest.version

$distDir = Join-Path $root "dist"
if (-not (Test-Path $distDir)) { New-Item -ItemType Directory -Path $distDir | Out-Null }

$zipPath = Join-Path $distDir "algolens-$version.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath }

$includePatterns = @(
    "manifest.json",
    "background.js",
    "content.js",
    "inline.css",
    "sidepanel.html",
    "sidepanel.css",
    "sidepanel.js",
    "onboarding.html",
    "onboarding.css",
    "onboarding.js",
    "privacy.html",
    "icons/icon16.png",
    "icons/icon32.png",
    "icons/icon48.png",
    "icons/icon128.png"
)

$stage = Join-Path $distDir "stage-$version"
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Path $stage | Out-Null

foreach ($rel in $includePatterns) {
    $src = Join-Path $root $rel
    if (-not (Test-Path $src)) {
        Write-Warning "missing: $rel — skipping"
        continue
    }
    $dst = Join-Path $stage $rel
    $dstDir = Split-Path -Parent $dst
    if (-not (Test-Path $dstDir)) { New-Item -ItemType Directory -Path $dstDir | Out-Null }
    Copy-Item $src $dst
}

Compress-Archive -Path (Join-Path $stage "*") -DestinationPath $zipPath -CompressionLevel Optimal
Remove-Item $stage -Recurse -Force

$size = [math]::Round((Get-Item $zipPath).Length / 1KB, 1)
Write-Host ""
Write-Host "wrote $zipPath ($size KB)"
Write-Host "upload this to the Chrome Web Store developer dashboard."
