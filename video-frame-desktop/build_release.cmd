@echo off
cd /d %~dp0

call scripts\ensure_icon.cmd
if errorlevel 1 exit /b 1

echo [1/2] Build Tauri...
call npm run tauri:build
if errorlevel 1 (
  echo Build failed.
  pause
  exit /b 1
)

echo [2/2] Copy latest setup exe to project root...
for /f "delims=" %%F in ('dir /b /o-d "src-tauri\target\release\bundle\nsis\*-setup.exe"') do (
  copy /y "src-tauri\target\release\bundle\nsis\%%F" ".\%%F"
  echo Copied: %%F
  goto :done
)

echo No setup exe found.
:done
pause
