@echo off
chcp 65001 >nul
title StreamKit - demarrage automatique
set "RACCOURCI=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\StreamKit.lnk"
if exist "%RACCOURCI%" (
  del "%RACCOURCI%"
  echo.
  echo   StreamKit ne se lancera plus au demarrage de Windows.
  echo.
) else (
  echo.
  echo   Le demarrage automatique n'etait pas active.
  echo.
)
pause
