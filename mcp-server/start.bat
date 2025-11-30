@echo off
REM Macro Tracker MCP Server Startup Script

REM Check if GITHUB_TOKEN is set
if "%GITHUB_TOKEN%"=="" (
    echo ERROR: GITHUB_TOKEN environment variable is not set!
    echo.
    echo Please set your GitHub token first:
    echo   set GITHUB_TOKEN=ghp_your_token_here
    echo.
    echo Or add it to your system environment variables for permanent setup.
    pause
    exit /b 1
)

REM Set port (default: 7870)
if "%PORT%"=="" set PORT=7870

REM Set transport mode (default: http)
if "%TRANSPORT%"=="" set TRANSPORT=http

echo Starting Macro Tracker MCP Server...
echo Transport: %TRANSPORT%
echo Port: %PORT%
echo.

node dist\index.js
