@echo off
title Gemini JanitorAI Guest Proxy
echo Starting Gemini Guest Proxy for JanitorAI...

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed!
    echo Please install Node.js (version 18 or newer) from https://nodejs.org
    pause
    exit /b
)

if not exist node_modules (
    echo Installing dependencies...
    npm install
)

npm start
pause
