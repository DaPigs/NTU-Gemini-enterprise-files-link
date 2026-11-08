@echo off
setlocal

if not exist "%~dp0vibe-sync.ps1" (
    echo [ERROR] Keep start-vibe-bridge.cmd and vibe-sync.ps1 in the same folder.
    pause
    exit /b 1
)

if not exist "%~dp0bridge-delta.cjs" (
    echo [ERROR] Keep bridge-delta.cjs with the other bridge files.
    pause
    exit /b 1
)

"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy RemoteSigned -File "%~dp0vibe-sync.ps1"
set "watcherExit=%ERRORLEVEL%"
if not "%watcherExit%"=="0" (
    echo.
    echo The watcher stopped with an error. Read the message above.
    pause
)
exit /b %watcherExit%
