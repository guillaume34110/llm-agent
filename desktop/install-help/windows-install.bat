@echo off
REM Double-click this file to install Monkey safely on Windows.
REM
REM Why: Monkey is unsigned (no $300/year code-signing cert). Windows
REM SmartScreen blocks unsigned installers by default. This script tells
REM Windows to trust the bundled MSI, then runs it.
REM
REM Source: https://github.com/guillaume34110/llm-agent-

setlocal
set "INSTALLER=%~dp0Monkey.msi"

if not exist "%INSTALLER%" (
  echo Could not find Monkey.msi next to this script.
  echo Place windows-install.bat in the same folder as Monkey.msi and try again.
  pause
  exit /b 1
)

echo Unblocking installer (removing Windows Mark-of-the-Web)...
powershell -NoProfile -Command "Unblock-File -Path '%INSTALLER%'"

echo Launching installer...
start "" "%INSTALLER%"
endlocal
