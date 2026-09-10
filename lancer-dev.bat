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

REM On teste la presence du PAQUET, pas du binaire Electron : depuis Electron
REM 42, npm install ne telecharge plus l'executable, c'est le premier
REM lancement qui s'en charge. Chercher dist\electron.exe ici relancerait donc
REM un npm install inutile a chaque fois, sans jamais rien y changer.
if not exist "node_modules\electron\package.json" (
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
