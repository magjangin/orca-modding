@echo off
chcp 65001 >nul
rem Launch the Orca Duo desktop app (installs Electron on the first run)
cd /d "%~dp0"
if not exist "node_modules\electron\dist\electron.exe" (
  echo [Orca Duo] First run, installing Electron...
  call npm install --no-audit --no-fund
  if not exist "node_modules\electron\dist\electron.exe" node node_modules\electron\install.js
)
start "" "node_modules\electron\dist\electron.exe" "%~dp0."
