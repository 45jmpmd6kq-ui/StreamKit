@echo off
chcp 65001 >nul
title StreamKit
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js n'est pas installe sur ce PC.
  echo   Telecharge-le sur https://nodejs.org ^(version LTS^), puis relance ce fichier.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo.
  echo   Premiere installation, patiente un instant...
  echo.
  call npm install --omit=dev --no-audit --no-fund
)

echo.
echo   StreamKit demarre.
echo   Dashboard : http://127.0.0.1:4455
echo.
echo   Laisse cette fenetre ouverte pendant le stream.
echo   Pour arreter : ferme la fenetre, ou Ctrl+C.
echo.

start "" http://127.0.0.1:4455
node src/index.js

echo.
echo   StreamKit s'est arrete.
pause
