@echo off
echo ============================================
echo  HALQA Backend - Restart with 512MB heap
echo ============================================
echo.
echo Step 1: Killing existing Node processes on port 5000...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5000 " ^| findstr "LISTENING"') do (
    echo Killing PID %%a
    taskkill /F /PID %%a 2>nul
)
echo.
echo Step 2: Waiting 2 seconds...
timeout /t 2 /nobreak >nul
echo.
echo Step 3: Regenerating Prisma client (needed after schema changes)...
cd /d "%~dp0"
call npx prisma generate
echo.
echo Step 4: Starting backend with 512MB heap...
node --max-old-space-size=512 --expose-gc src/app.js
pause
