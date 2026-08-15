@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d "%~dp0"

set PORT=%1
if "%PORT%"=="" set PORT=8080

echo.
echo   Базис — доступ с других устройств по локальной сети
echo   ---------------------------------------------------

rem --- адрес компьютера в локальной сети ---
set IP=
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
  if not defined IP set IP=%%a
)
set IP=%IP: =%

echo.
echo   На этом компьютере:  http://localhost:%PORT%/
if defined IP echo   С телефона/планшета: http://%IP%:%PORT%/
echo.
echo   Устройство должно быть в той же сети Wi-Fi.
echo   При первом запуске Windows спросит разрешение сети — разрешите для ЧАСТНОЙ сети.
echo   Закрыть это окно = выключить сервер.
echo.

where python >nul 2>nul && (
  echo   Раздаю папку через Python...
  python -m http.server %PORT%
  goto :eof
)
where py >nul 2>nul && (
  echo   Раздаю папку через Python...
  py -3 -m http.server %PORT%
  goto :eof
)
where npx >nul 2>nul && (
  echo   Раздаю папку через Node...
  npx --yes http-server -p %PORT%
  goto :eof
)

echo   Ни Python, ни Node не найдены — запускаю встроенный сервер Windows.
echo   Потребуются права администратора: Windows разрешает слушать сеть только так.
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','%~dp0server.ps1','-Port','%PORT%'"
