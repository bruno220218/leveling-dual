@echo off
setlocal
cd /d "%~dp0"
title Leveling Dual
if exist "LevelingDual.exe" (
  start "" "%~dp0LevelingDual.exe"
  exit /b
)
where node >nul 2>nul
if errorlevel 1 (
  echo Para iniciar esta versao de codigo-fonte, instale o Node.js LTS:
  echo https://nodejs.org/
  echo Depois, feche esta janela e abra INICIAR.bat novamente.
  pause
  exit /b 1
)
if not exist "node_modules\electron\dist\electron.exe" (
  echo Preparando o aplicativo. Aguarde o download inicial...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo Nao foi possivel preparar o aplicativo. Confira sua conexao.
    pause
    exit /b 1
  )
)
call npm start
if errorlevel 1 pause
