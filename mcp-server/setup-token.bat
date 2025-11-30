@echo off
echo ========================================
echo GitHub Token Setup for Macro Tracker MCP
echo ========================================
echo.
echo Please paste your GitHub token below and press Enter:
echo (It should start with ghp_)
echo.
set /p GITHUB_TOKEN="Token: "

echo.
echo Setting up environment variable...

REM Set the environment variable permanently for the current user
setx GITHUB_TOKEN "%GITHUB_TOKEN%"

echo.
echo ========================================
echo SUCCESS! Your token has been saved.
echo ========================================
echo.
echo IMPORTANT: Close this window and open a NEW Command Prompt
echo Then run: start.bat
echo.
pause
