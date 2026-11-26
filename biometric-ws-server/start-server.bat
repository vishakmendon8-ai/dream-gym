@echo off
title Dream Gym - Secureye Biometric WebSocket Server (Port 8080)
cd /d "%~dp0"

echo ===================================================================
echo   Dream Gym - Secureye Biometric WebSocket Server
echo ===================================================================
echo.

where node >nul 2>nul
if %errorlevel% neq 0 (
  echo [ERROR] Node.js is not installed on this PC!
  echo Install Node.js LTS from: https://nodejs.org/
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Installing dependencies ^(first time only^)...
  call npm install --no-audit --no-fund
)

echo.
echo Starting WebSocket Server on Port 8080...
echo If Windows Firewall asks for permission, click "Allow access" on Private networks.
echo.
call npm start
pause
