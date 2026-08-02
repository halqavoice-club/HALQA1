# ═══════════════════════════════════════════════════════════════════════════════
# HALQA — Daily Session Backup Script
# Commits current work, exports MySQL, and creates a timestamped archive.
#
# Usage:
#   .\scripts\backup-daily.ps1 -Message "feat(auth): add refresh token"
#   .\scripts\backup-daily.ps1          # uses auto-generated message
#
# Schedule with Windows Task Scheduler for automatic nightly backups.
# ═══════════════════════════════════════════════════════════════════════════════

param(
    [Parameter(Mandatory=$false)]
    [string]$Message = "",

    # MySQL connection (reads from backend\.env if not specified)
    [string]$DBHost     = "localhost",
    [string]$DBPort     = "3306",
    [string]$DBName     = "halqa_db",
    [string]$DBUser     = "root",
    [string]$DBPassword = "",

    # Where to store archives (default: Desktop\HALQA-Backups)
    [string]$BackupRoot = "$env:USERPROFILE\Desktop\HALQA-Backups"
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

$Timestamp = Get-Date -Format "yyyy-MM-dd_HH-mm"
$DateLabel = Get-Date -Format "yyyy-MM-dd"

function Write-Step([string]$msg) { Write-Host "`n[$msg]" -ForegroundColor Cyan }
function Write-OK([string]$msg)   { Write-Host "  ✅ $msg" -ForegroundColor Green }
function Write-WARN([string]$msg) { Write-Host "  ⚠  $msg" -ForegroundColor Yellow }
function Write-ERR([string]$msg)  { Write-Host "  ❌ $msg" -ForegroundColor Red }

Write-Host @"
═══════════════════════════════════════════════════════════════════════════════
  HALQA Daily Backup — $Timestamp
═══════════════════════════════════════════════════════════════════════════════
"@ -ForegroundColor Cyan

# ── Read .env for DB credentials if not passed as params ──────────────────
Write-Step "Reading configuration"
$envFile = "backend\.env"
if (Test-Path $envFile -and $DBPassword -eq "") {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match '^DATABASE_URL="?mysql://([^:]+):([^@]*)@([^:]+):(\d+)/([^"?]+)') {
            $DBUser     = $Matches[1]
            $DBPassword = $Matches[2]
            $DBHost     = $Matches[3]
            $DBPort     = $Matches[4]
            $DBName     = $Matches[5].TrimEnd('"')
        }
    }
    Write-OK "DB config loaded from backend\.env"
}

# ── 1. Git status check ───────────────────────────────────────────────────
Write-Step "Checking Git status"

if (-not (Test-Path ".git")) {
    Write-ERR "Git not initialized. Run scripts\git-setup.ps1 first."
    exit 1
}

$changed = git status --short
if ($changed) {
    $count = ($changed | Measure-Object -Line).Lines
    Write-OK "$count file(s) changed since last commit"
} else {
    Write-WARN "No changes detected — nothing to commit"
}

# ── 2. Stage and commit all changes ──────────────────────────────────────
Write-Step "Creating Git commit"

if ($changed) {
    # Auto-generate commit message if not provided
    if ($Message -eq "") {
        $changedFiles = git diff --name-only HEAD 2>$null
        $newFiles     = git ls-files --others --exclude-standard 2>$null
        
        $summary = @()
        if ($changedFiles) { $summary += "modified: $($changedFiles -split '\n' | Measure-Object | Select-Object -ExpandProperty Count) files" }
        if ($newFiles)     { $summary += "added: $($newFiles -split '\n' | Measure-Object | Select-Object -ExpandProperty Count) files" }
        
        $Message = "chore(backup): session save $Timestamp — $($summary -join ', ')"
    }

    git add .
    git commit -m $Message
    Write-OK "Committed: $Message"
} else {
    Write-WARN "Skipping commit — no changes"
}

# ── 3. Push to GitHub ─────────────────────────────────────────────────────
Write-Step "Pushing to GitHub"

$currentBranch = git branch --show-current
try {
    git push origin $currentBranch 2>&1
    Write-OK "Pushed branch '$currentBranch' to GitHub"
} catch {
    Write-WARN "Push failed — check internet connection and GitHub credentials"
    Write-WARN "Your commit is safe locally. Push manually: git push origin $currentBranch"
}

# ── 4. MySQL backup ───────────────────────────────────────────────────────
Write-Step "Backing up MySQL database"

$BackupDir = "$BackupRoot\$DateLabel"
New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null

$SqlFile = "$BackupDir\halqa_db_$Timestamp.sql"

# Try mysqldump (XAMPP)
$mysqldumpPaths = @(
    "C:\xampp\mysql\bin\mysqldump.exe",
    "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysqldump.exe",
    "C:\Program Files\MySQL\MySQL Server 5.7\bin\mysqldump.exe",
    "mysqldump"  # if in PATH
)

$mysqldump = $null
foreach ($path in $mysqldumpPaths) {
    if ($path -eq "mysqldump") {
        try { $null = Get-Command mysqldump -ErrorAction Stop; $mysqldump = "mysqldump"; break }
        catch { }
    } elseif (Test-Path $path) {
        $mysqldump = $path
        break
    }
}

if ($mysqldump) {
    try {
        if ($DBPassword -ne "") {
            & $mysqldump "-h$DBHost" "-P$DBPort" "-u$DBUser" "-p$DBPassword" `
                "--single-transaction" "--routines" "--triggers" "--events" `
                "--set-gtid-purged=OFF" $DBName | Out-File -FilePath $SqlFile -Encoding UTF8
        } else {
            & $mysqldump "-h$DBHost" "-P$DBPort" "-u$DBUser" `
                "--single-transaction" "--routines" "--triggers" "--events" `
                "--set-gtid-purged=OFF" $DBName | Out-File -FilePath $SqlFile -Encoding UTF8
        }
        
        $sqlSize = [math]::Round((Get-Item $SqlFile).Length / 1KB, 1)
        Write-OK "Database exported: $SqlFile ($sqlSize KB)"
    } catch {
        Write-WARN "MySQL export failed: $_"
        Write-WARN "Continuing without database backup"
    }
} else {
    Write-WARN "mysqldump not found — skipping database backup"
    Write-WARN "Install XAMPP or add MySQL bin directory to PATH"
}

# ── 5. Source code archive ────────────────────────────────────────────────
Write-Step "Creating source code archive"

$ArchiveFile = "$BackupDir\halqa_source_$Timestamp.zip"

# Build exclusion list
$Excludes = @(
    "node_modules", ".next", "dist", "build", "out",
    ".git", "logs", "coverage", ".nyc_output",
    "mobile\.expo", "mobile\android\build", "mobile\ios\build",
    "backend\uploads\audio\*", "backend\uploads\avatars\*",
    "backend\uploads\media\*", "__pycache__",
    "*.apk", "*.aab", "*.log"
)

try {
    # Use PowerShell's built-in Compress-Archive with file filtering
    $TempList = @()
    
    Get-ChildItem -Path $ProjectRoot -Recurse -File | Where-Object {
        $relativePath = $_.FullName.Substring($ProjectRoot.Length + 1)
        $exclude = $false
        foreach ($ex in $Excludes) {
            if ($relativePath -like "*\$ex\*" -or $relativePath -like "*\$ex" -or $relativePath -like $ex) {
                $exclude = $true
                break
            }
        }
        -not $exclude
    } | ForEach-Object { $TempList += $_.FullName }
    
    # Compress using .NET
    Add-Type -Assembly 'System.IO.Compression.FileSystem'
    
    if (Test-Path $ArchiveFile) { Remove-Item $ArchiveFile -Force }
    
    $zip = [System.IO.Compression.ZipFile]::Open($ArchiveFile, 'Create')
    foreach ($file in $TempList) {
        $relativePath = $file.Substring($ProjectRoot.Length + 1)
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
            $zip, $file, $relativePath,
            [System.IO.Compression.CompressionLevel]::Optimal
        ) | Out-Null
    }
    $zip.Dispose()
    
    $archiveSize = [math]::Round((Get-Item $ArchiveFile).Length / 1MB, 1)
    Write-OK "Archive created: $ArchiveFile ($archiveSize MB, $($TempList.Count) files)"
} catch {
    Write-WARN "Archive creation failed: $_"
}

# ── 6. Cleanup old backups (keep 30 days) ─────────────────────────────────
Write-Step "Cleaning up old backups"

$CutoffDate = (Get-Date).AddDays(-30)
Get-ChildItem -Path $BackupRoot -Directory | Where-Object {
    $_.LastWriteTime -lt $CutoffDate
} | ForEach-Object {
    Remove-Item $_.FullName -Recurse -Force
    Write-WARN "Removed old backup: $($_.Name)"
}
Write-OK "Kept backups from last 30 days"

# ── Summary ───────────────────────────────────────────────────────────────
Write-Host @"

═══════════════════════════════════════════════════════════════════════════════
  Backup Complete — $Timestamp
  Location: $BackupDir
═══════════════════════════════════════════════════════════════════════════════

  Git commit:  $Message
  Branch:      $currentBranch
  Archive:     halqa_source_$Timestamp.zip
  Database:    halqa_db_$Timestamp.sql

  TIP: Run this after every work session.
       Command: .\scripts\backup-daily.ps1 -Message "feat(module): description"
═══════════════════════════════════════════════════════════════════════════════
"@ -ForegroundColor Green
