# Stream Dock AJAZZ (AKP05E) - Plugin Installer for PowerShell
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host "   Stream Dock AJAZZ (AKP05E) - Automatická instalace pluginů" -ForegroundColor Cyan
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host ""

$targetDir = Join-Path $env:APPDATA "HotSpot\StreamDock\plugins"
$sourceDir = Join-Path $PSScriptRoot "plugins"

if (-not (Test-Path $sourceDir)) {
    Write-Host "[CHYBA] Složka 'plugins' nebyla nalezena ve stejném adresáři jako tento skript." -ForegroundColor Red
    exit 1
}

if (-not (Test-Path $targetDir)) {
    New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
}

$plugins = Get-ChildItem -Path $sourceDir -Directory -Filter "*.sdPlugin"
foreach ($p in $plugins) {
    $dest = Join-Path $targetDir $p.Name
    Write-Host "[INSTALUJI] $($p.Name) -> $dest" -ForegroundColor Green
    Copy-Item -Path $p.FullName -Destination $dest -Recurse -Force
}

Write-Host ""
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host "[HOTOVO] Všechny pluginy byly úspěšně nakopírovány do Stream Docku." -ForegroundColor Green
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host ""

$ans = Read-Host "Chcete nyní restartovat aplikaci Stream Dock AJAZZ? (A/N)"
if ($ans -eq "A" -or $ans -eq "a") {
    Write-Host "Restartuji Stream Dock..." -ForegroundColor Yellow
    Stop-Process -Name "Stream Dock AJAZZ" -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    $appExe = "C:\Program Files (x86)\Stream Dock AJAZZ Global\Stream Dock AJAZZ.exe"
    if (Test-Path $appExe) {
        Start-Process -FilePath $appExe -WorkingDirectory (Split-Path $appExe)
        Write-Host "Aplikace byla úspěšně spuštěna." -ForegroundColor Green
    } else {
        Write-Host "Spusťte Stream Dock ručně z nabídky Start." -ForegroundColor Yellow
    }
}
