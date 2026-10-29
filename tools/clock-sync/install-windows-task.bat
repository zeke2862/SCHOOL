@echo off
rem Create the daily Windows scheduled task (Thailand time 17:10). Right-click -> Run as administrator.
rem Keep this file ASCII-only: cmd misreads UTF-8 batch files under chcp 65001.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-windows-task.ps1"
pause
