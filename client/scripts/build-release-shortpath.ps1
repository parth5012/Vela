#requires -Version 5.1
<#
.SYNOPSIS
  Issue #149: reproducible Android release build from a true short-path copy.

.DESCRIPTION
  Windows MAX_PATH limits break the native (CMake/ninja) build when the repo
  sits in a deep path. Copying to a short root (default D:\a) fixes the paths -
  BUT a naive copy drags the old location back in: pnpm's node_modules is full
  of junctions pointing at D:\work, so the copied tree resolves dependencies
  from the ORIGINAL long path again and CMake dies on react-native-screens /
  react-native-worklets.

  This script encodes the working recipe:
    1. robocopy /MIR /XJ  (XJ = never copy junctions/symlinks)
    2. fresh FLAT npm install inside the copy (never reuse pnpm's node_modules)
    3. clean android\.cxx and android\app\build in the copy
    4. gradlew assembleRelease
    5. LEAK GATE: fail if any CMake artifact references the original repo path

.PARAMETER DestRoot
  Short destination root. Default: D:\a  (copy lands at <DestRoot>\client)

.PARAMETER SkipCopy
  Skip steps 1-3 (rerun gradle + leak gate against an existing copy).

.PARAMETER Prebuild
  OPT-IN: run `npx expo prebuild -p android --clean` before building.
  WARNING: regenerates android/ and DISCARDS manual native edits.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\build-release-shortpath.ps1
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\build-release-shortpath.ps1 -SkipCopy
#>
param(
    [string]$DestRoot = 'D:\a',
    [switch]$SkipCopy,
    [switch]$Prebuild
)

$ErrorActionPreference = 'Stop'

$ClientSource = Split-Path -Parent $PSScriptRoot    # ...\Vela\client
$RepoRoot     = Split-Path -Parent $ClientSource    # ...\Vela
$Dest         = Join-Path $DestRoot 'client'

# Leak marker: drive + first path segment of the repo, e.g. 'D:/work/'.
# Trailing slash avoids false positives like 'D:/workspace'.
$segments = $RepoRoot -split '[\\/]' | Where-Object { $_ }
if ($segments.Count -ge 2) {
    $LeakPattern = ($segments[0..1] -join '/') + '/'
} else {
    $LeakPattern = $segments[0] + '/'
}

function Step([string]$Msg) { Write-Host "`n=== $Msg ===" -ForegroundColor Cyan }

Write-Host "Source : $ClientSource"
Write-Host "Dest   : $Dest"
Write-Host "Gate   : fail if CMake artifacts contain '$LeakPattern'"

if (-not $SkipCopy) {
    Step "Step 1/5: robocopy /MIR /XJ -> $Dest"
    # /XJ excludes junction/symlink mount points - THIS is what stops D:\work's
    # pnpm layout from leaking into the copy. robocopy exit codes < 8 = success.
    robocopy $ClientSource $Dest /MIR /XJ /NFL /NDL /NP `
        /XD "$ClientSource\node_modules" `
            "$ClientSource\.expo" `
            "$ClientSource\.git" `
            "$ClientSource\android\.cxx" `
            "$ClientSource\android\app\build"
    if ($LASTEXITCODE -ge 8) { throw "robocopy failed with exit code $LASTEXITCODE" }

    Step "Step 2/5: fresh flat npm install in the copy"
    $destNodeModules = Join-Path $Dest 'node_modules'
    if (Test-Path $destNodeModules) {
        Remove-Item -Recurse -Force $destNodeModules
    }
    Push-Location $Dest
    try {
        npm install --legacy-peer-deps
        if ($LASTEXITCODE -ne 0) { throw "npm install failed with exit code $LASTEXITCODE" }
    } finally { Pop-Location }

    Step "Step 3/5: cleaning native build caches in the copy"
    foreach ($stale in @('android\.cxx', 'android\app\build')) {
        $p = Join-Path $Dest $stale
        if (Test-Path $p) { Remove-Item -Recurse -Force $p }
    }
} else {
    Step "Steps 1-3/5: skipped (-SkipCopy)"
}

if ($Prebuild) {
    Write-Warning '-Prebuild regenerates android/ and DISCARDS manual native edits.'
    Push-Location $Dest
    try {
        npx expo prebuild -p android --clean
        if ($LASTEXITCODE -ne 0) { throw "expo prebuild failed with exit code $LASTEXITCODE" }
    } finally { Pop-Location }
}

Step "Step 4/5: gradlew assembleRelease"
Push-Location (Join-Path $Dest 'android')
try {
    .\gradlew.bat assembleRelease
    if ($LASTEXITCODE -ne 0) { throw "gradlew assembleRelease failed with exit code $LASTEXITCODE" }
} finally { Pop-Location }

Step "Step 5/5: leak gate - scanning CMake artifacts for '$LeakPattern'"
$cxxDir = Join-Path $Dest 'android\.cxx'
if (-not (Test-Path $cxxDir)) {
    Write-Warning "No .cxx directory at $cxxDir - nothing to scan."
} else {
    $artifacts = @(Get-ChildItem -Path $cxxDir -Recurse -File -Include *.ninja.txt, CMakeCache.txt)
    $offenders = @()
    foreach ($f in $artifacts) {
        $hits = @(Select-String -Path $f.FullName -SimpleMatch $LeakPattern -ErrorAction SilentlyContinue)
        if ($hits.Count -gt 0) { $offenders += $f.FullName }
    }
    if ($offenders.Count -gt 0) {
        Write-Host "LEAK DETECTED - these artifacts still reference '$LeakPattern':" -ForegroundColor Red
        foreach ($o in $offenders) { Write-Host "  $o" -ForegroundColor Red }
        exit 1
    }
    Write-Host "Clean: no '$LeakPattern' references across $($artifacts.Count) scanned artifacts." -ForegroundColor Green
}

Write-Host ""
Write-Host "DONE. APK: $Dest\android\app\build\outputs\apk\release\" -ForegroundColor Green
