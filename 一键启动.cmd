@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
title American Debate - One-click setup

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\one-click-setup.ps1"
set "SETUP_EXIT_CODE=%ERRORLEVEL%"

if not "%SETUP_EXIT_CODE%"=="0" (
  echo.
  echo Setup failed. See the message above and .one-click-setup.log for details.
  pause
)

exit /b %SETUP_EXIT_CODE%
