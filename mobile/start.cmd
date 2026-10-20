@echo off
echo Starting HALQA Mobile...
echo.

REM Check if node_modules/.bin/expo exists
if not exist "node_modules\.bin\expo" (
    echo [ERROR] node_modules not installed yet.
    echo Run: npm install --legacy-peer-deps
    pause
    exit /b 1
)

REM Patch expo-updates CLI if it has the Node 24 bug
set PATCH_FILE=node_modules\expo-updates\build-cli\cli.js
if exist "%PATCH_FILE%" (
    node -e "const fs=require('fs');const f='%PATCH_FILE%';let c=fs.readFileSync(f,'utf8');if(c.includes('commands[command]()')){c=c.replace('commands[command]()',\"(commands[command]||(()=>Promise.reject(new Error('Unknown command: '+command))))()\");fs.writeFileSync(f,c,'utf8');console.log('expo-updates patched for Node 24');}"
)

REM Start Expo using the local binary directly
node node_modules\expo\bin\cli start %*
