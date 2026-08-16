@echo off
setlocal
cd /d "%~dp0"
set PORT=%1
if "%PORT%"=="" set PORT=8080
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1" -Port %PORT%
pause
