$ErrorActionPreference = 'Stop'
$desktop = Split-Path $PSScriptRoot -Parent
$rcedit = Join-Path $env:LOCALAPPDATA 'electron-builder\Cache\winCodeSign\fixed-2.6.0\rcedit-x64.exe'
$icon = Join-Path $desktop 'build\icon.ico'
$exe = Join-Path $desktop 'dist\win-unpacked\Streamlol.exe'
if (-not (Test-Path $rcedit)) {
    Write-Host 'rcedit not found; skip icon embed (exe still runs)'
    exit 0
}
if (Test-Path $exe) {
    & $rcedit $exe --set-icon $icon
    Write-Host "Icon applied: $exe"
}
