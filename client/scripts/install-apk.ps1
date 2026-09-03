#Requires -Version 5.1
<#
.SYNOPSIS
  Install correct ABI split APK to connected device/emulator.
  Avoids "App not installed" from mismatched ABI and avoids big universal APK.
.DESCRIPTION
  Detects device ABI via `adb shell getprop ro.product.cpu.abi` and installs
  the matching split from `android/app/build/outputs/apk/release/`.
  Config: client/plugins/withAbiSplits.js:6 includes ['arm64-v8a','x86_64']
  with universalApk=false, so assembleRelease emits:
    app-arm64-v8a-release.apk  -> physical phones
    app-x86_64-release.apk     -> emulators (AVD)
  Usage:
    powershell -ExecutionPolicy Bypass -File scripts/install-apk.ps1
    powershell -ExecutionPolicy Bypass -File scripts/install-apk.ps1 -Emulator
    powershell -ExecutionPolicy Bypass -File scripts/install-apk.ps1 -DeviceId emulator-5554
#>
param(
  [string]$DeviceId = "",
  [switch]$Emulator,
  [switch]$CleanInstall,
  [switch]$Production
)

$ErrorActionPreference = "Stop"

$Adb = "adb"
if (-not (Get-Command $Adb -ErrorAction SilentlyContinue)) {
  $Adb = "$env:ANDROID_HOME\platform-tools\adb.exe"
  if (-not (Test-Path $Adb)) { $Adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" }
}
if (-not (Test-Path $Adb) -and -not (Get-Command adb -ErrorAction SilentlyContinue)) {
  throw "adb not found. Set ANDROID_HOME or add platform-tools to PATH."
}

function AdbArgs([string[]]$Extra) {
  $a = @()
  if ($DeviceId) { $a += @("-s", $DeviceId) }
  return $a + $Extra
}

# Pick device if not specified
$devices = & $Adb devices | Where-Object { $_ -match "^\S+\s+device$" }
if (-not $DeviceId) {
  if ($devices.Count -eq 0) { throw "No devices/emulators found. Start emulator or connect phone (adb devices)." }
  if ($devices.Count -gt 1 -and -not $Emulator) {
    Write-Host "Multiple targets:" -ForegroundColor Yellow
    $devices | ForEach-Object { Write-Host "  $_" }
    Write-Host "Use -DeviceId <id> or -Emulator to pick one."
    throw "Ambiguous device"
  }
  if ($Emulator) {
    $emu = $devices | Where-Object { $_ -match "^emulator-" }
    if (-not $emu) { throw "No emulator found (adb devices shows no emulator-XXXX). Start AVD first." }
    $DeviceId = ($emu[0] -split "\s+")[0]
    Write-Host "Picked emulator: $DeviceId" -ForegroundColor Cyan
  } else {
    $DeviceId = (($devices[0] -split "\s+")[0])
    Write-Host "Picked device: $DeviceId" -ForegroundColor Cyan
  }
}

$abi = (& $Adb @(AdbArgs @("shell", "getprop", "ro.product.cpu.abi")) | Out-String).Trim()
if (-not $abi) { throw "Failed to read ro.product.cpu.abi from $DeviceId" }
Write-Host "Device ABI: $abi" -ForegroundColor Green

$apkDir = Join-Path $PSScriptRoot "..\android\app\build\outputs\apk\release"
# For production builds the APK is still at same path but internal package differs.
# If you built with -Production, you must have run with APP_VARIANT=production prebuild.
# Detect mismatch: check if apk internally matches expected package.
if (-not (Test-Path $apkDir)) { throw "No build output at $apkDir. Run scripts/build-release-shortpath.ps1 first or ./gradlew assembleRelease" }
$expectedPkg = if ($Production) { "com.parth5012.client" } else { "com.parth5012.client.dev" }
Write-Host "Expecting package: $expectedPkg $(if ($Production) {'(production)'} else {'(dev)'})" -ForegroundColor DarkGray

$map = @{
  "arm64-v8a" = "app-arm64-v8a-release.apk"
  "x86_64"    = "app-x86_64-release.apk"
  "armeabi-v7a" = $null  # not included in ABI_INCLUDE, would need config change
}

# Choose APK
$apkName = $map[$abi]
if (-not $apkName) {
  Write-Warning "ABI $abi not in ABI_INCLUDE ['arm64-v8a','x86_64'] (client/plugins/withAbiSplits.js:6). No matching APK."
  Write-Warning "Either add $abi to ABI_INCLUDE or use universal APK (set universalApk=true)."
  throw "No APK for ABI $abi"
}
$apkPath = Join-Path $apkDir $apkName
if (-not (Test-Path $apkPath)) {
  throw "Missing $apkPath. Did assembleRelease complete? Files: $((Get-ChildItem $apkDir -Filter *.apk | Select-Object -ExpandProperty Name) -join ', ')"
}
$sizeMb = [math]::Round((Get-Item $apkPath).Length / 1MB, 1)
Write-Host "Installing $apkName ($sizeMb MB) -> $DeviceId" -ForegroundColor Cyan

if ($CleanInstall) {
  $pkgDev = "com.parth5012.client.dev"
  $pkgProd = "com.parth5012.client"
  Write-Host "Clean install: uninstalling previous $pkgDev / $pkgProd if present..."
  & $Adb @(AdbArgs @("uninstall", $pkgDev)) | Out-Null
  & $Adb @(AdbArgs @("uninstall", $pkgProd)) | Out-Null
}

# Optional verify packageId matches expected (uses aapt2 if available)
$btRoot = "$env:LOCALAPPDATA\Android\Sdk\build-tools"
$latestBt = Get-ChildItem $btRoot -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -First 1
if ($latestBt) {
  $aapt2 = Join-Path $latestBt.FullName "aapt2.exe"
  if (Test-Path $aapt2) {
    $dump = & $aapt2 dump packagename $apkPath 2>&1 | Out-String
    $dump = $dump.Trim()
    if ($dump -and $dump -ne $expectedPkg) {
      Write-Warning "APK package $dump != expected $expectedPkg. You built $(if ($dump -match '\.dev'){'dev'}else{'production'}) but asked for $(if ($Production){'production'}else{'dev'}). Rebuild with correct flag: -Production needs APP_VARIANT=production prebuild (client/app.config.js:39, client/android/app/build.gradle:106)."
    } else { Write-Host "Verified APK package: $dump" -ForegroundColor DarkGray }
  }
}

& $Adb @(AdbArgs @("install", "-r", $apkPath))
if ($LASTEXITCODE -ne 0) { throw "adb install failed ($LASTEXITCODE). Try -CleanInstall to fix signature mismatch (debug keystore vs prod key), or check logcat: adb logcat | findstr PackageManager" }
Write-Host "Installed $apkName ($expectedPkg) to $DeviceId" -ForegroundColor Green
