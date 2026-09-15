@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0manage.ps1" -Action stop
set "result=%errorlevel%"
if /I not "%~1"=="--no-pause" pause
exit /b %result%
