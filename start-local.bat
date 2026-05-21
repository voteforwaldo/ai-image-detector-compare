@echo off
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is not installed. Install from https://nodejs.org/
  pause
  exit /b 1
)

if not exist ".env" (
  echo Missing .env in %CD%
  if exist ".env.example" copy /Y ".env.example" ".env" >nul
  echo Edit .env with your API keys, save, then run again.
  notepad ".env"
  pause
  exit /b 1
)

start "AI Detector" cmd /k cd /d "%~dp0" ^&^& node server.mjs
