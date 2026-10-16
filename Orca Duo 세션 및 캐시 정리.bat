@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title Orca Duo 세션 및 캐시 정리 도구

:MENU
cls
echo ================================================================
echo             Orca Duo 세션 메모리 및 캐시 정리 도구
echo ================================================================
echo.
echo  이 도구는 대화가 누적되면서 쌓인 에이전트 세션 파일과
echo  임시 이미지/캐시를 안전하게 정리하여 디스크 공간을 확보합니다.
echo  (※ 로그인 인증 정보, API 키, 플러그인, 설정값은 절대 삭제되지 않습니다)
echo.
echo ----------------------------------------------------------------
echo  [1] 빠른 정리 (Orca 첨부 이미지 캐시 + 임시 캐시 파일만 삭제)
echo  [2] Claude 세션 정리 (sessions, cache, file-history 삭제)
echo  [3] Antigravity 세션 정리 (brain 산출물, cache, crashes 삭제)
echo  [4] 전체 세션/캐시 완전 정리 (1, 2, 3번 일괄 정리)
echo  [5] Orca 대화 기록(conversations)까지 모두 비우기 (완전 초기화)
echo  [Q] 종료
echo ----------------------------------------------------------------
set /p "CHOICE=선택할 번호를 입력하세요: "

if /i "%CHOICE%"=="1" goto CLEAN_LIGHT
if /i "%CHOICE%"=="2" goto CLEAN_CLAUDE
if /i "%CHOICE%"=="3" goto CLEAN_AGY
if /i "%CHOICE%"=="4" goto CLEAN_ALL
if /i "%CHOICE%"=="5" goto CLEAN_RESET
if /i "%CHOICE%"=="Q" goto EXIT

echo 잘못된 입력입니다. 다시 입력해 주세요.
timeout /t 1 >nul
goto MENU

:CLEAN_LIGHT
echo.
echo [1] 가벼운 정리를 시작합니다...
call :CLEAN_ORCA_ATTACHMENTS
call :CLEAN_TEMP_CACHE
echo.
echo ✔ 가벼운 정리가 완료되었습니다!
pause
goto MENU

:CLEAN_CLAUDE
echo.
echo [2] Claude Code 세션 및 캐시 정리를 시작합니다...
call :CLEAN_CLAUDE_DIR
echo.
echo ✔ Claude 세션 정리가 완료되었습니다!
pause
goto MENU

:CLEAN_AGY
echo.
echo [3] Antigravity 세션 및 캐시 정리를 시작합니다...
call :CLEAN_AGY_DIR
echo.
echo ✔ Antigravity 세션 정리가 완료되었습니다!
pause
goto MENU

:CLEAN_ALL
echo.
echo [4] 전체 세션 및 캐시 정리를 시작합니다...
call :CLEAN_ORCA_ATTACHMENTS
call :CLEAN_TEMP_CACHE
call :CLEAN_CLAUDE_DIR
call :CLEAN_AGY_DIR
echo.
echo ✔ 전체 세션 및 캐시 정리가 완료되었습니다!
pause
goto MENU

:CLEAN_RESET
echo.
echo ⚠️ 경고: Orca Duo에 저장된 모든 대화 목록과 메시지가 삭제됩니다!
echo (설정 파일 settings.json은 안전하게 보존됩니다)
set /p "CONFIRM=정말로 대화 기록을 모두 비우시겠습니까? (Y/N): "
if /i not "%CONFIRM%"=="Y" goto MENU

call :CLEAN_ORCA_ATTACHMENTS
call :CLEAN_CLAUDE_DIR
call :CLEAN_AGY_DIR
set "ORCA_CONV=%USERPROFILE%\.orca-duo\conversations"
if exist "%ORCA_CONV%" (
    echo [삭제 중] %ORCA_CONV%
    del /q /f "%ORCA_CONV%\*.*" 2>nul
)
echo.
echo ✔ Orca Duo 대화 기록 및 세션이 완전히 초기화되었습니다.
pause
goto MENU

:: ─────────────────────────────────────────────────────────────
:: 세부 삭제 루틴 함수들
:: ─────────────────────────────────────────────────────────────

:CLEAN_ORCA_ATTACHMENTS
set "ORCA_ATT=%USERPROFILE%\.orca-duo\attachments"
if exist "%ORCA_ATT%" (
    echo - Orca 첨부 이미지 캐시 비우기: %ORCA_ATT%
    del /q /f "%ORCA_ATT%\*.*" 2>nul
)
exit /b

:CLEAN_TEMP_CACHE
set "CLAUDE_CACHE=%USERPROFILE%\.claude\cache"
set "AGY_CACHE=%USERPROFILE%\.gemini\antigravity\cache"
set "AGY_CRASH=%USERPROFILE%\.gemini\antigravity\crashes"
if exist "%CLAUDE_CACHE%" del /s /q /f "%CLAUDE_CACHE%\*.*" 2>nul
if exist "%AGY_CACHE%" del /s /q /f "%AGY_CACHE%\*.*" 2>nul
if exist "%AGY_CRASH%" del /s /q /f "%AGY_CRASH%\*.*" 2>nul
exit /b

:CLEAN_CLAUDE_DIR
set "CL_DIR=%USERPROFILE%\.claude"
if exist "%CL_DIR%\sessions" (
    echo - Claude 세션 로그 정리: %CL_DIR%\sessions
    del /q /f "%CL_DIR%\sessions\*.*" 2>nul
)
if exist "%CL_DIR%\session-env" del /q /f "%CL_DIR%\session-env\*.*" 2>nul
if exist "%CL_DIR%\file-history" del /s /q /f "%CL_DIR%\file-history\*.*" 2>nul
if exist "%CL_DIR%\shell-snapshots" del /q /f "%CL_DIR%\shell-snapshots\*.*" 2>nul
if exist "%CL_DIR%\cache" del /s /q /f "%CL_DIR%\cache\*.*" 2>nul
exit /b

:CLEAN_AGY_DIR
set "AGY_DIR=%USERPROFILE%\.gemini\antigravity"
if exist "%AGY_DIR%\brain" (
    echo - Antigravity brain 아티팩트 정리: %AGY_DIR%\brain
    for /d %%D in ("%AGY_DIR%\brain\*") do rd /s /q "%%D" 2>nul
    del /q /f "%AGY_DIR%\brain\*.*" 2>nul
)
if exist "%AGY_DIR%\cache" del /s /q /f "%AGY_DIR%\cache\*.*" 2>nul
if exist "%AGY_DIR%\crashes" del /s /q /f "%AGY_DIR%\crashes\*.*" 2>nul
exit /b

:EXIT
exit /b 0
