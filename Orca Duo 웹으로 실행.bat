@echo off
chcp 65001 >nul
rem Run in the browser without Electron (only Node.js is required). Closing this window also stops the server.
cd /d "%~dp0"
node server\index.js --open
