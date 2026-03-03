@echo off
cd /d %~dp0\..

if not exist src-tauri\icons mkdir src-tauri\icons

if not exist src-tauri\icons\icon.ico (
  echo [icon] missing, generating...
  powershell -NoProfile -Command "Invoke-WebRequest 'https://raw.githubusercontent.com/tauri-apps/tauri/dev/crates/tauri-cli/templates/app/src-tauri/icons/128x128.png' -OutFile 'src-tauri/icons/app.png'"
  npx @tauri-apps/cli icon src-tauri\icons\app.png
)

if exist src-tauri\icons\icon.ico (
  echo [icon] OK
) else (
  echo [icon] FAILED
  exit /b 1
)
