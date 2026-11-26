@echo off
title Dream Gym - Secureye LAN Bridge & ADMS Server
cd /d "%~dp0"

echo ===================================================================
echo   Dream Gym - Secureye Local LAN Bridge (Port 8080)
echo ===================================================================
echo.

where node >nul 2>nul
if %errorlevel% neq 0 (
  echo [ERROR] Node.js 22+ is not installed!
  echo Download Node.js LTS from: https://nodejs.org/
  pause
  exit /b 1
)

if not exist ".env" (
  echo Creating .env from .env.example...
  copy /Y ".env.example" ".env" >nul
)

if not exist "node_modules" (
  echo Installing bridge dependencies ^(first run only^)...
  call npm install
)

echo.
echo Starting Secureye LAN Bridge...
echo Tip: If Windows Defender Firewall pops up, click "Allow access" for Private networks.
echo.
call npm start
pause
