@echo off
REM ============================================================
REM  Al-Amal Accounting System - One-Click Launcher
REM  Starts the dev server (if not already running) and opens
REM  the app in your default browser once it is ready.
REM  This is a local dev convenience script - no source/UI files
REM  are touched by it.
REM ============================================================
setlocal EnableDelayedExpansion
cd /d "%~dp0"

set "URL=http://localhost:3000/"

REM The project's "dev" script pipes through "tee" (a Git-for-Windows tool),
REM which is not on the plain Windows PATH for a desktop double-click. Append
REM (not prepend) its folder so "npm run dev" can find tee, while native tools
REM like the Windows timeout.exe and curl.exe are still resolved first.
if exist "C:\Program Files\Git\usr\bin\tee.exe" (
    set "PATH=%PATH%;C:\Program Files\Git\usr\bin"
)

echo.
echo   Al-Amal Accounting System - Launcher
echo   =====================================
echo.

call :check_status
if "!HTTP_CODE!"=="200" (
    echo Server is already running.
    goto :open_browser
)

echo Starting development server in the background...
start "Al-Amal Dev Server" /min cmd /c "npm run dev"

echo Waiting for the server to become ready...
set /a TRIES=0

:waitloop
set /a TRIES+=1
ping -n 2 127.0.0.1 >nul
call :check_status
if "!HTTP_CODE!"=="200" goto :ready
if !TRIES! GEQ 60 goto :timeout_msg
goto :waitloop

:timeout_msg
echo Could not confirm the server is ready after 60 seconds.
echo Opening the browser anyway - check the "Al-Amal Dev Server" window for errors.
goto :open_browser

:ready
echo Server is ready.

:open_browser
echo Opening http://localhost:3000/ in your browser...
start "" "%URL%"
goto :eof

:check_status
curl -s -o nul -w "%%{http_code}" %URL% > "%TEMP%\amal_status.tmp" 2>nul
set /p HTTP_CODE=<"%TEMP%\amal_status.tmp"
del "%TEMP%\amal_status.tmp" >nul 2>&1
exit /b
