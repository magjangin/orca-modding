@echo off
chcp 65001 >nul
rem Orca Duo 데스크톱 앱 실행 (처음 한 번은 Electron 설치)
cd /d "%~dp0"
if not exist "node_modules\electron\dist\electron.exe" (
  echo [Orca Duo] 처음 실행이라 Electron 을 설치합니다...
  call npm install --no-audit --no-fund
  if not exist "node_modules\electron\dist\electron.exe" node node_modules\electron\install.js
)
start "" "node_modules\electron\dist\electron.exe" "%~dp0."
