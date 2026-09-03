@echo off
setlocal
title DORN AI - Validacion de inicio
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0COMPROBAR-DORN.ps1" -NoPause
if errorlevel 1 (
  echo.
  echo DORN no se inicio porque la validacion detecto una descarga incompleta.
  echo Conserva esta ventana y comparte el resultado para diagnosticarla.
  pause
  exit /b 1
)
start "" "%~dp0DORN AI.exe" --safe-mode
exit /b 0
