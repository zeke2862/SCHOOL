@echo off
rem Run the clock sync once. Messages are printed by sync-clock.mjs (see sync.log).
rem Keep this file ASCII-only: cmd misreads UTF-8 batch files under chcp 65001.
cd /d "%~dp0"
node sync-clock.mjs %*
set RC=%ERRORLEVEL%
if /i not "%~1"=="--scheduled" pause
exit /b %RC%
