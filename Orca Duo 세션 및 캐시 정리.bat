@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title Orca Duo Session and Cache Cleaner

:MENU
cls
echo ================================================================
echo             Orca Duo Session Memory and Cache Cleaner
echo ================================================================
echo.
echo  This tool safely cleans up agent session files and
echo  temporary images/caches built up over time to free disk space.
echo  (Login credentials, API keys, plugins and settings are NOT deleted)
echo.
echo ----------------------------------------------------------------
echo  [1] Quick clean (Orca attachment image cache + temp cache files only)
echo  [2] Clean Claude sessions (deletes projects, sessions, file-history, cache)
echo  [3] Clean Antigravity sessions (deletes brain artifacts, conversations, cache)
echo  [4] Full session/cache clean (runs 1, 2 and 3 together)
echo  [5] Also wipe Orca conversation history (full reset)
echo  [Q] Quit
echo ----------------------------------------------------------------
set /p "CHOICE=Enter a number: "

if /i "%CHOICE%"=="1" goto CLEAN_LIGHT
if /i "%CHOICE%"=="2" goto CLEAN_CLAUDE
if /i "%CHOICE%"=="3" goto CLEAN_AGY
if /i "%CHOICE%"=="4" goto CLEAN_ALL
if /i "%CHOICE%"=="5" goto CLEAN_RESET
if /i "%CHOICE%"=="Q" goto EXIT

echo Invalid input. Please try again.
timeout /t 1 >nul
goto MENU

:CLEAN_LIGHT
echo.
echo [1] Starting quick clean...
call :CLEAN_ORCA_ATTACHMENTS
call :CLEAN_TEMP_CACHE
echo.
echo [+] Quick clean complete!
pause
goto MENU

:CLEAN_CLAUDE
echo.
echo [2] Starting Claude Code session and cache clean...
call :CLEAN_CLAUDE_DIR
echo.
echo [+] Claude session clean complete!
pause
goto MENU

:CLEAN_AGY
echo.
echo [3] Starting Antigravity session and cache clean...
call :CLEAN_AGY_DIR
echo.
echo [+] Antigravity session clean complete!
pause
goto MENU

:CLEAN_ALL
echo.
echo [4] Starting full session and cache clean...
call :CLEAN_ORCA_ATTACHMENTS
call :CLEAN_TEMP_CACHE
call :CLEAN_CLAUDE_DIR
call :CLEAN_AGY_DIR
echo.
echo [+] Full session and cache clean complete!
pause
goto MENU

:CLEAN_RESET
echo.
echo [!] WARNING: All conversations and messages stored in Orca Duo will be deleted!
echo (settings.json and models.json are preserved)
set /p "CONFIRM=Really wipe all conversation history? (Y/N): "
if /i not "%CONFIRM%"=="Y" goto MENU

call :CLEAN_ORCA_ATTACHMENTS
call :CLEAN_CLAUDE_DIR
call :CLEAN_AGY_DIR
set "ORCA_CONV=%USERPROFILE%\.orca-duo\conversations"
if exist "%ORCA_CONV%" (
    echo [Deleting] %ORCA_CONV%
    for /d %%D in ("%ORCA_CONV%\*") do rd /s /q "%%D" 2>nul
    del /q /f "%ORCA_CONV%\*.*" 2>nul
)
echo.
echo [+] Orca Duo conversation history and sessions have been fully reset.
pause
goto MENU

:: -------------------------------------------------------------
:: Detailed cleanup routines
:: -------------------------------------------------------------

:CLEAN_ORCA_ATTACHMENTS
set "ORCA_ATT=%USERPROFILE%\.orca-duo\attachments"
if exist "%ORCA_ATT%" (
    echo - Clearing Orca attachment image cache: %ORCA_ATT%
    for /d %%D in ("%ORCA_ATT%\*") do rd /s /q "%%D" 2>nul
    del /q /f "%ORCA_ATT%\*.*" 2>nul
)
exit /b

:CLEAN_TEMP_CACHE
set "CLAUDE_CACHE=%USERPROFILE%\.claude\cache"
set "AGY_CACHE=%USERPROFILE%\.gemini\antigravity\cache"
set "AGY_CRASH=%USERPROFILE%\.gemini\antigravity\crashes"
if exist "%CLAUDE_CACHE%" (
    for /d %%D in ("%CLAUDE_CACHE%\*") do rd /s /q "%%D" 2>nul
    del /q /f "%CLAUDE_CACHE%\*.*" 2>nul
)
if exist "%AGY_CACHE%" (
    for /d %%D in ("%AGY_CACHE%\*") do rd /s /q "%%D" 2>nul
    del /q /f "%AGY_CACHE%\*.*" 2>nul
)
if exist "%AGY_CRASH%" (
    for /d %%D in ("%AGY_CRASH%\*") do rd /s /q "%%D" 2>nul
    del /q /f "%AGY_CRASH%\*.*" 2>nul
)
exit /b

:CLEAN_CLAUDE_DIR
set "CL_DIR=%USERPROFILE%\.claude"
if exist "%CL_DIR%\projects" (
    echo - Cleaning Claude per-project session/conversation logs: %CL_DIR%\projects
    for /d %%D in ("%CL_DIR%\projects\*") do rd /s /q "%%D" 2>nul
    del /q /f "%CL_DIR%\projects\*.*" 2>nul
)
if exist "%CL_DIR%\sessions" (
    echo - Cleaning Claude session logs: %CL_DIR%\sessions
    for /d %%D in ("%CL_DIR%\sessions\*") do rd /s /q "%%D" 2>nul
    del /q /f "%CL_DIR%\sessions\*.*" 2>nul
)
if exist "%CL_DIR%\file-history" (
    echo - Cleaning Claude file history cache: %CL_DIR%\file-history
    for /d %%D in ("%CL_DIR%\file-history\*") do rd /s /q "%%D" 2>nul
    del /q /f "%CL_DIR%\file-history\*.*" 2>nul
)
if exist "%CL_DIR%\session-env" (
    for /d %%D in ("%CL_DIR%\session-env\*") do rd /s /q "%%D" 2>nul
    del /q /f "%CL_DIR%\session-env\*.*" 2>nul
)
if exist "%CL_DIR%\shell-snapshots" (
    for /d %%D in ("%CL_DIR%\shell-snapshots\*") do rd /s /q "%%D" 2>nul
    del /q /f "%CL_DIR%\shell-snapshots\*.*" 2>nul
)
if exist "%CL_DIR%\cache" (
    for /d %%D in ("%CL_DIR%\cache\*") do rd /s /q "%%D" 2>nul
    del /q /f "%CL_DIR%\cache\*.*" 2>nul
)
exit /b

:CLEAN_AGY_DIR
set "AGY_DIR=%USERPROFILE%\.gemini\antigravity"
if exist "%AGY_DIR%\brain" (
    echo - Cleaning Antigravity brain artifacts: %AGY_DIR%\brain
    for /d %%D in ("%AGY_DIR%\brain\*") do rd /s /q "%%D" 2>nul
    del /q /f "%AGY_DIR%\brain\*.*" 2>nul
)
if exist "%AGY_DIR%\conversations" (
    echo - Cleaning Antigravity conversation session logs: %AGY_DIR%\conversations
    for /d %%D in ("%AGY_DIR%\conversations\*") do rd /s /q "%%D" 2>nul
    del /q /f "%AGY_DIR%\conversations\*.*" 2>nul
)
if exist "%AGY_DIR%\cache" (
    for /d %%D in ("%AGY_DIR%\cache\*") do rd /s /q "%%D" 2>nul
    del /q /f "%AGY_DIR%\cache\*.*" 2>nul
)
if exist "%AGY_DIR%\crashes" (
    for /d %%D in ("%AGY_DIR%\crashes\*") do rd /s /q "%%D" 2>nul
    del /q /f "%AGY_DIR%\crashes\*.*" 2>nul
)
exit /b

:EXIT
exit /b 0
