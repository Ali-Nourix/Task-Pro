@echo off
setlocal
cd /d "%~dp0"
title TaskPro bot - update

echo.
echo   TaskPro Telegram bot
echo   Updating the bot's functions on Supabase
echo   ----------------------------------------
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo   Node.js is not installed. Install it from https://nodejs.org and run this file again.
  goto :end
)

rem Use only a locally linked project; never ship a personal project reference.
set "REF=%SUPABASE_PROJECT_REF%"
if exist "supabase\.temp\project-ref" set /p REF=<"supabase\.temp\project-ref"
if not defined REF (
  echo   No project linked. Run: npx supabase link --project-ref YOUR_PROJECT_REF
  goto :end
)
echo.

set "FAILED="
call :deploy_all
if defined FAILED (
  echo.
  echo   The first try did not work. Most likely you are not signed in to Supabase yet.
  echo   A browser window will open: sign in, then come back to this window.
  echo.
  call npx --yes supabase@latest login
  set "FAILED="
  call :deploy_all
)

if defined FAILED (
  echo.
  echo   It still did not work. Review the error locally. Redact credentials and project identifiers before sharing logs.
  goto :end
)

echo.
echo   Done. The bot is updated.
echo   Open it in Telegram and send /start to see the new menu.
goto :end

:deploy_all
for %%F in (telegram sync tick) do (
  echo   Deploying %%F ...
  call npx --yes supabase@latest functions deploy %%F --project-ref %REF% --no-verify-jwt --use-api
  if errorlevel 1 set "FAILED=1"
)
exit /b

:end
echo.
pause
