@echo off
setlocal
set "BASE=%~dp0"
set "NODE_EXE=node.exe"

where node.exe >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
  if exist "C:\Program Files (x86)\Stream Dock AJAZZ Global\node\node20.exe" (
    set "NODE_EXE=C:\Program Files (x86)\Stream Dock AJAZZ Global\node\node20.exe"
  ) else (
    exit /b 2
  )
)

"%NODE_EXE%" "%BASE%index.js" %*
exit /b %ERRORLEVEL%
