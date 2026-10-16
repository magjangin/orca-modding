@echo off
chcp 65001 >nul
rem Electron 없이 브라우저로 실행 (Node.js만 있으면 됨). 이 창을 닫으면 서버도 꺼집니다.
cd /d "%~dp0"
node server\index.js --open
