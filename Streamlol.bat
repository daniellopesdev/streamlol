@echo off
setlocal
cd /d "%~dp0"

if not exist "desktop\dist\win-unpacked\Streamlol.exe" (
  echo Building Streamlol first...
  if not exist "web\build\index.html" (
    echo Building web UI...
    pushd web
    call npx --yes pnpm@11.8.0 run build
    if errorlevel 1 exit /b 1
    popd
  )
  pushd desktop
  call npm install
  if errorlevel 1 exit /b 1
  call npm run pack
  if errorlevel 1 exit /b 1
  popd
)

if not exist "addon\node_modules\" (
  pushd addon
  call npm install
  popd
)

start "Streamlol addon" /min cmd /c "cd /d "%~dp0addon" && node src\server.js"
timeout /t 1 /nobreak >nul
start "" "%~dp0desktop\dist\win-unpacked\Streamlol.exe"
