@echo off
chcp 65001 >nul
cd /d "I:\ttong_project\nexus-pipeline-clean"

echo [1/3] Firestore Rules deploy...
call npx firebase deploy --only firestore:rules --account ttong627@gmail.com --project logis-op
if errorlevel 1 exit /b 1

echo [2/3] vite build...
call npx vite build
if errorlevel 1 exit /b 1

echo [3/3] Hosting deploy (predeploy bypass)...
copy /Y firebase.json _firebase.json.bak >nul
powershell -NoProfile -Command "$j = Get-Content 'firebase.json' -Raw | ConvertFrom-Json; $j.hosting.PSObject.Properties.Remove('predeploy'); $j | ConvertTo-Json -Depth 40 | Set-Content 'firebase.json' -Encoding UTF8"
call npx firebase deploy --only hosting --account ttong627@gmail.com --project logis-op
set DEPLOY_ERR=%errorlevel%
move /Y _firebase.json.bak firebase.json >nul
if %DEPLOY_ERR% neq 0 exit /b 1

echo DEPLOY_OK https://logis-op.web.app
exit /b 0
