@echo off
:: ═══════════════════════════════════════════════════════════════════════════
:: HALQA Quick Backup — Windows Batch
:: Double-click or schedule with Task Scheduler
:: ═══════════════════════════════════════════════════════════════════════════

title HALQA Quick Backup

:: Get project root (parent of scripts folder)
set "SCRIPT_DIR=%~dp0"
set "PROJECT_ROOT=%SCRIPT_DIR%..\"
cd /d "%PROJECT_ROOT%"

echo.
echo  ╔══════════════════════════════════════════════════════╗
echo  ║         HALQA Quick Backup - Session Save            ║
echo  ╚══════════════════════════════════════════════════════╝
echo.

:: ── Check Git ──────────────────────────────────────────────────────────────
git --version >nul 2>&1
if errorlevel 1 (
    echo  [ERROR] Git not found. Install from https://git-scm.com/download/win
    pause
    exit /b 1
)

:: ── Check if git repo ──────────────────────────────────────────────────────
if not exist ".git" (
    echo  [ERROR] Git not initialized. Run: scripts\git-setup.ps1 first
    pause
    exit /b 1
)

:: ── Git status ─────────────────────────────────────────────────────────────
echo  [1/4] Checking Git status...
git status --short
echo.

:: ── Stage all changes ──────────────────────────────────────────────────────
echo  [2/4] Staging changes...
git add .

:: ── Generate timestamp commit message ─────────────────────────────────────
for /f "tokens=1-4 delims=/ " %%a in ('date /t') do set DATE=%%b-%%c-%%d
for /f "tokens=1-2 delims=: " %%a in ('time /t') do set TIME=%%a%%b

:: Remove spaces from time
set TIME=%TIME: =%

set COMMIT_MSG=chore(backup): session save %DATE% %TIME%

:: ── Commit ─────────────────────────────────────────────────────────────────
echo  [3/4] Committing...
git diff --cached --quiet >nul 2>&1
if errorlevel 1 (
    git commit -m "%COMMIT_MSG%"
    if errorlevel 1 (
        echo  [WARN] Commit failed - check for pre-commit hook errors above
    ) else (
        echo  [OK] Committed: %COMMIT_MSG%
    )
) else (
    echo  [INFO] No staged changes to commit
)

:: ── Push to GitHub ─────────────────────────────────────────────────────────
echo  [4/4] Pushing to GitHub...
for /f %%b in ('git branch --show-current') do set BRANCH=%%b
git push origin %BRANCH%
if errorlevel 1 (
    echo  [WARN] Push failed. Your commit is safe locally.
    echo         Push manually: git push origin %BRANCH%
) else (
    echo  [OK] Pushed to GitHub (branch: %BRANCH%)
)

echo.
echo  ╔══════════════════════════════════════════════════════╗
echo  ║  Backup complete! Code is safe on GitHub.            ║
echo  ╚══════════════════════════════════════════════════════╝
echo.
pause
