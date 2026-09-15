@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0manage.ps1" -Action start
set "result=%errorlevel%"
if /I not "%~1"=="--no-pause" pause
exit /b %result%
