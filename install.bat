@echo off
chcp 65001 >nul
title Stream Dock AJAZZ (AKP05E) - Instalace pluginů
cls

echo ======================================================================
echo    Stream Dock AJAZZ (AKP05E) - Automatická instalace pluginů
echo ======================================================================
echo.

set "TARGET_DIR=%APPDATA%\HotSpot\StreamDock\plugins"
set "SOURCE_DIR=%~dp0plugins"

if not exist "%SOURCE_DIR%" (
    echo [CHYBA] Složka plugins nebyla nalezena!
    echo Ujistěte se, že spouštíte instalátor z rozbaleného archivu repozitáře.
    echo.
    pause
    exit /b 1
)

echo Cílová složka pluginů:
echo %TARGET_DIR%
echo.

if not exist "%TARGET_DIR%" (
    echo Vytvářím cílovou složku...
    mkdir "%TARGET_DIR%"
)

echo Kopíruji pluginy...
echo.

rem Kopírování jednotlivých pluginů
for /d %%D in ("%SOURCE_DIR%\*.sdPlugin") do (
    echo [INSTALUJI] %%~nxD ...
    xcopy "%%D" "%TARGET_DIR%\%%~nxD\" /E /I /Y /Q >nul
)

echo.
echo ======================================================================
echo [HOTOVO] Všechny pluginy byly úspěšně nainstalovány!
echo ======================================================================
echo.
echo Chcete nyní restartovat aplikaci "Stream Dock AJAZZ", aby se pluginy načetly?
set /p RESTART="Zadejte A pro restart, nebo libovolnou jinou klávesu pro ukončení: "

if /i "%RESTART%"=="A" (
    echo.
    echo Ukončuji běžící instanci Stream Dock...
    taskkill /F /IM "Stream Dock AJAZZ.exe" /T >nul 2>&1
    timeout /t 2 /nobreak >nul
    
    echo Spouštím Stream Dock AJAZZ...
    if exist "C:\Program Files (x86)\Stream Dock AJAZZ Global\Stream Dock AJAZZ.exe" (
        start "" "C:\Program Files (x86)\Stream Dock AJAZZ Global\Stream Dock AJAZZ.exe"
    ) else (
        echo [INFO] Spusťte Stream Dock ručně z nabídky Start.
    )
)

echo.
echo Děkujeme za použití!
timeout /t 3 >nul
exit /b 0
