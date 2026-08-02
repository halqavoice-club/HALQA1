# ═══════════════════════════════════════════════════════════════════════════════
# HALQA — Git Repository Setup Script
# Run once to initialize Git, configure hooks, and connect to GitHub.
#
# Usage:
#   .\scripts\git-setup.ps1 -GitHubUsername "your-username" -RepoName "halqa"
#
# Requirements:
#   - Git for Windows 2.x installed
#   - GitHub account with SSH key or HTTPS credentials configured
# ═══════════════════════════════════════════════════════════════════════════════

param(
    [Parameter(Mandatory=$true)]
    [string]$GitHubUsername,

    [Parameter(Mandatory=$false)]
    [string]$RepoName = "halqa",

    [Parameter(Mandatory=$false)]
    [string]$DefaultBranch = "main",

    # Use HTTPS instead of SSH (easier for Windows beginners)
    [switch]$UseHTTPS
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot

Set-Location $ProjectRoot

function Write-Step([string]$msg) { Write-Host "`n[$msg]" -ForegroundColor Cyan }
function Write-OK([string]$msg)   { Write-Host "  ✅ $msg" -ForegroundColor Green }
function Write-WARN([string]$msg) { Write-Host "  ⚠  $msg" -ForegroundColor Yellow }
function Write-ERR([string]$msg)  { Write-Host "  ❌ $msg" -ForegroundColor Red }

# ── 1. Check Git is installed ──────────────────────────────────────────────
Write-Step "Checking prerequisites"
try {
    $gitVersion = git --version
    Write-OK "Found: $gitVersion"
} catch {
    Write-ERR "Git not found. Install from https://git-scm.com/download/win"
    exit 1
}

# ── 2. Initialize Git repository ──────────────────────────────────────────
Write-Step "Initializing Git repository"
if (Test-Path ".git") {
    Write-WARN ".git already exists — skipping init (history preserved)"
} else {
    git init
    Write-OK "Git initialized"
}

# Set default branch name
git checkout -b $DefaultBranch 2>$null
if ($LASTEXITCODE -ne 0) {
    git branch -M $DefaultBranch
}
Write-OK "Default branch set to '$DefaultBranch'"

# ── 3. Configure Git identity (skip if already set) ───────────────────────
Write-Step "Git identity"
$gitName  = git config user.name 2>$null
$gitEmail = git config user.email 2>$null

if (-not $gitName) {
    $gitName = Read-Host "  Enter your full name (for commits)"
    git config user.name $gitName
}
if (-not $gitEmail) {
    $gitEmail = Read-Host "  Enter your email (for commits)"
    git config user.email $gitEmail
}
Write-OK "Identity: $gitName <$gitEmail>"

# ── 4. Install Git hooks ───────────────────────────────────────────────────
Write-Step "Installing Git hooks"
$hooksDir = ".git\hooks"
$sourceDir = "scripts\git-hooks"

if (Test-Path $sourceDir) {
    Copy-Item "$sourceDir\pre-commit" "$hooksDir\pre-commit" -Force
    Copy-Item "$sourceDir\pre-push"   "$hooksDir\pre-push"   -Force
    # Git hooks must be executable (no-op on Windows but good practice)
    Write-OK "Hooks installed: pre-commit, pre-push"
} else {
    Write-WARN "Hook source directory not found — skipping"
}

# ── 5. Configure Git aliases ───────────────────────────────────────────────
Write-Step "Configuring Git aliases"
git config alias.st   "status"
git config alias.co   "checkout"
git config alias.br   "branch"
git config alias.lg   "log --oneline --graph --decorate --all"
git config alias.last "log -1 HEAD --stat"
git config alias.undo "reset HEAD~1 --mixed"
git config alias.save "!git add -A && git commit -m 'WIP: save progress'"
git config alias.aliases "config --get-regexp alias"
Write-OK "Aliases: st, co, br, lg, last, undo, save, aliases"

# ── 6. Set up remote origin ───────────────────────────────────────────────
Write-Step "Configuring GitHub remote"

if ($UseHTTPS) {
    $RemoteURL = "https://github.com/$GitHubUsername/$RepoName.git"
} else {
    $RemoteURL = "git@github.com:$GitHubUsername/$RepoName.git"
}

$existingRemote = git remote get-url origin 2>$null
if ($existingRemote) {
    if ($existingRemote -eq $RemoteURL) {
        Write-OK "Remote already correct: $RemoteURL"
    } else {
        Write-WARN "Existing remote: $existingRemote"
        Write-WARN "Updating to:     $RemoteURL"
        git remote set-url origin $RemoteURL
        Write-OK "Remote updated"
    }
} else {
    git remote add origin $RemoteURL
    Write-OK "Remote added: $RemoteURL"
}

# ── 7. Create branch structure ────────────────────────────────────────────
Write-Step "Creating branch structure"

# We create local branch references without pushing yet
git branch develop 2>$null
if ($LASTEXITCODE -eq 0) {
    Write-OK "Created branch: develop"
} else {
    Write-WARN "Branch 'develop' already exists"
}

Write-Host @"

  Branch strategy:
    main        — production-ready code only. Deploys automatically.
    develop     — integration branch. All feature branches merge here first.
    feature/*   — one branch per feature. Branch from develop.
    hotfix/*    — urgent production fixes. Branch from main, merge to both.
    release/*   — release candidates. Branch from develop when ready to ship.
"@ -ForegroundColor Gray

# ── 8. Security scan before first commit ──────────────────────────────────
Write-Step "Running security scan"

$secretPatterns = @(
    'sk_live_', 'sk_test_', 'pk_live_', 'pk_test_', 'whsec_',
    'AIza[0-9A-Za-z_-]{35}',
    'AKIA[0-9A-Z]{16}',
    'livekit.*secret',
    '-----BEGIN PRIVATE KEY',
    '-----BEGIN RSA PRIVATE KEY'
)

$issues = @()
Get-ChildItem -Recurse -File -Exclude "*.gitignore" | Where-Object {
    $_.FullName -notmatch '\\\.git\\' -and
    $_.FullName -notmatch '\\node_modules\\' -and
    $_.Extension -notin @('.png','.jpg','.jpeg','.gif','.ico','.apk','.aab','.woff','.ttf','.eot')
} | ForEach-Object {
    $file = $_
    if ($file.Length -lt 500KB) {  # Skip large binary-like files
        try {
            $content = Get-Content $file.FullName -Raw -ErrorAction SilentlyContinue
            if ($content) {
                foreach ($pattern in $secretPatterns) {
                    if ($content -match $pattern -and $file.Name -notmatch '\.example$') {
                        $issues += "$($file.FullName) — matches pattern: $pattern"
                        break
                    }
                }
            }
        } catch { }
    }
}

if ($issues.Count -gt 0) {
    Write-WARN "Potential secrets found in non-.env files:"
    $issues | ForEach-Object { Write-Host "    $_" -ForegroundColor Yellow }
    Write-WARN "Review these files and move secrets to .env before committing."
} else {
    Write-OK "No obvious secrets found outside .env files"
}

# ── 9. First commit ───────────────────────────────────────────────────────
Write-Step "Creating initial commit"

git add .
$status = git status --short
$fileCount = ($status | Measure-Object -Line).Lines

if ($fileCount -eq 0) {
    Write-WARN "Nothing to commit — repository may already be up to date"
} else {
    Write-Host "  Staging $fileCount file(s)..."
    git commit -m "chore: initial repository setup — HALQA monorepo

- Backend: Node.js/Express/Prisma/MySQL/Redis/LiveKit/Socket.IO
- Frontend: Next.js 14/TypeScript/Radix UI/Zustand
- Mobile: Expo 54/React Native 0.81.5
- CI/CD: GitHub Actions (ci.yml + deploy.yml)
- Hooks: pre-commit secret scanner + pre-push branch guard"

    Write-OK "Initial commit created"
}

# ── 10. Final instructions ─────────────────────────────────────────────────
Write-Host @"

═══════════════════════════════════════════════════════════════════════════════
  HALQA Git Setup Complete
═══════════════════════════════════════════════════════════════════════════════

  NEXT STEPS — do these ONCE manually:

  1. Create a PRIVATE GitHub repository:
     → Go to https://github.com/new
     → Name: $RepoName
     → Visibility: Private
     → Do NOT initialize with README (you already have code)
     → Click "Create repository"

  2. Push your code:
     git push -u origin $DefaultBranch
     git push -u origin develop

  3. Add GitHub Secrets for CI/CD (Settings → Secrets → Actions):
     DEPLOY_HOST       — your production server IP or hostname
     DEPLOY_USER       — SSH username on production server
     DEPLOY_SSH_KEY    — contents of your private SSH key (~/.ssh/id_rsa)
     DEPLOY_PORT       — SSH port (default 22)

  4. Create a GitHub Environment named 'production':
     Settings → Environments → New environment → production
     Add "Required reviewers" for manual deploy approval

  5. Push develop branch:
     git push -u origin develop

  Remote URL: $RemoteURL

═══════════════════════════════════════════════════════════════════════════════
"@ -ForegroundColor Green
