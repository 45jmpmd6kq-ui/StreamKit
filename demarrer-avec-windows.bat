@echo off
chcp 65001 >nul
title StreamKit - demarrage automatique
cd /d "%~dp0"

REM Cree un raccourci vers start.bat dans le dossier Demarrage de Windows.
REM StreamKit se lancera tout seul a l'ouverture de la session : plus besoin
REM d'y penser avant un live.

set "DEMARRAGE=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "RACCOURCI=%DEMARRAGE%\StreamKit.lnk"

powershell -NoProfile -Command ^
  "$s = (New-Object -ComObject WScript.Shell).CreateShortcut('%RACCOURCI%');" ^
  "$s.TargetPath = '%~dp0start.bat';" ^
  "$s.WorkingDirectory = '%~dp0';" ^
  "$s.WindowStyle = 7;" ^
  "$s.Description = 'StreamKit';" ^
  "$s.Save()"

if exist "%RACCOURCI%" (
  echo.
  echo   C'est fait : StreamKit se lancera automatiquement au demarrage de Windows.
  echo   Pour annuler : lance arreter-avec-windows.bat
  echo.
) else (
  echo.
  echo   Le raccourci n'a pas pu etre cree.
  echo   Tu peux lancer StreamKit a la main avec start.bat.
  echo.
)
pause
