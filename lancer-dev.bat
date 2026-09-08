@echo off
chcp 65001 >nul
title StreamKit - developpement
cd /d "%~dp0"

REM Lanceur de DEVELOPPEMENT uniquement. Les streamers, eux, recoivent
REM l'installeur .exe et n'ont jamais besoin de ce fichier.
REM
REM On appelle npm.cmd et pas npm : sous PowerShell, la strategie d'execution
REM par defaut (Restricted) refuse le wrapper npm.ps1. Le .cmd n'en depend pas,
REM donc ca marche sans toucher a la securite du poste.

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js n'est pas installe. https://nodejs.org ^(version LTS^)
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\electron\dist\electron.exe" (
  echo.
  echo   Dependances manquantes, installation...
  echo.
  call npm.cmd install
)

echo.
echo   Lancement de StreamKit...
echo   Ferme cette fenetre pour tout arreter.
echo.

call npm.cmd start

echo.
echo   StreamKit s'est arrete.
pause
