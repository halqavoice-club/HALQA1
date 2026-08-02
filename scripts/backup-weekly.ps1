# ═══════════════════════════════════════════════════════════════════════════════
# HALQA — Weekly Full Backup Script
# Comprehensive backup: MySQL, source, Prisma schema, docs, env templates
#
# Usage:
#   .\scripts\backup-weekly.ps1
#   .\scripts\backup-weekly.ps1 -BackupRoot "D:\Backups\HALQA"
# ═══════════════════════════════════════════════════════════════════════════════

param(
    [string]$BackupRoot = "$env:USERPROFILE\Desktop\HALQA-Backups\weekly",
    [string]$DBHost     = "localhost",
    [string]$DBPort     = "3306",
    [string]$DBName     = "halqa_db",
    [string]$DBUser     = "root",
    [string]$DBPassword = ""
)

$ErrorActionPreference = "Continue"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

$Timestamp = Get-Date -Format "yyyy-MM-dd_HH-mm"
$WeekLabel  = "week-$(Get-Date -Format 'yyyy-WW')"
$BackupDir  = "$BackupRoot\$WeekLabel"

function Write-Step([string]$m) { Write-Host "`n[$m]" -ForegroundColor Cyan }
function Write-OK([string]$m)   { Write-Host "  ✅ $m" -ForegroundColor Green }
function Write-WARN([string]$m) { Write-Host "  ⚠  $m" -ForegroundColor Yellow }

Write-Host @"
═══════════════════════════════════════════════════════════════════════════════
  HALQA Weekly Full Backup — $Timestamp ($WeekLabel)
═══════════════════════════════════════════════════════════════════════════════
"@ -ForegroundColor Cyan

New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null

# ── Read .env for DB config ────────────────────────────────────────────────
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
}

# ── 1. Git log export ──────────────────────────────────────────────────────
Write-Step "Exporting Git history"
git log --oneline --graph --all > "$BackupDir\git-history.txt" 2>&1
git log --format="%H|%an|%ae|%ai|%s" --all > "$BackupDir\git-commits.csv" 2>&1
Write-OK "Git history saved"

# ── 2. MySQL full backup ───────────────────────────────────────────────────
Write-Step "MySQL full backup (all databases)"

$mysqldumpPaths = @(
    "C:\xampp\mysql\bin\mysqldump.exe",
    "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysqldump.exe",
    "mysqldump"
)

$mysqldump = $null
foreach ($path in $mysqldumpPaths) {
    if ($path -eq "mysqldump") {
        try { $null = Get-Command mysqldump -ErrorAction Stop; $mysqldump = "mysqldump"; break }
        catch { }
    } elseif (Test-Path $path) { $mysqldump = $path; break }
}

if ($mysqldump) {
    $SqlFile = "$BackupDir\halqa_db_full_$Timestamp.sql"
    try {
        if ($DBPassword -ne "") {
            & $mysqldump "-h$DBHost" "-P$DBPort" "-u$DBUser" "-p$DBPassword" `
                "--single-transaction" "--routines" "--triggers" "--events" `
                "--add-drop-database" "--databases" $DBName |
                Out-File -FilePath $SqlFile -Encoding UTF8
        } else {
            & $mysqldump "-h$DBHost" "-P$DBPort" "-u$DBUser" `
                "--single-transaction" "--routines" "--triggers" "--events" `
                "--add-drop-database" "--databases" $DBName |
                Out-File -FilePath $SqlFile -Encoding UTF8
        }
        $size = [math]::Round((Get-Item $SqlFile).Length / 1KB, 1)
        Write-OK "Database: $SqlFile ($size KB)"
    } catch {
        Write-WARN "MySQL export failed: $_"
    }
}

# ── 3. Prisma schema backup ────────────────────────────────────────────────
Write-Step "Backing up Prisma schema and migrations"
$prismaDir = "$BackupDir\prisma"
New-Item -ItemType Directory -Path $prismaDir -Force | Out-Null

if (Test-Path "backend\prisma\schema.prisma") {
    Copy-Item "backend\prisma\schema.prisma" "$prismaDir\schema.prisma"
    Write-OK "Prisma schema copied"
}
if (Test-Path "backend\prisma\migrations") {
    Copy-Item "backend\prisma\migrations" "$prismaDir\migrations" -Recurse
    Write-OK "Prisma migrations copied"
}
if (Test-Path "backend\prisma\seed.js") {
    Copy-Item "backend\prisma\seed.js" "$prismaDir\seed.js"
}

# ── 4. Package.json files (dependency manifest) ───────────────────────────
Write-Step "Backing up package manifests"
$pkgDir = "$BackupDir\packages"
New-Item -ItemType Directory -Path $pkgDir -Force | Out-Null

foreach ($sub in @(".", "backend", "frontend", "mobile")) {
    if (Test-Path "$sub\package.json") {
        $dest = "$pkgDir\$($sub -replace '\.','root')_package.json"
        Copy-Item "$sub\package.json" $dest
    }
    if (Test-Path "$sub\package-lock.json") {
        $dest = "$pkgDir\$($sub -replace '\.','root')_package-lock.json"
        Copy-Item "$sub\package-lock.json" $dest
    }
}
Write-OK "Package manifests saved"

# ── 5. Environment templates ───────────────────────────────────────────────
Write-Step "Backing up .env example files (safe — no real secrets)"
$envDir = "$BackupDir\env-templates"
New-Item -ItemType Directory -Path $envDir -Force | Out-Null

Get-ChildItem -Recurse -Filter "*.env.example" | ForEach-Object {
    $dest = $_.FullName.Replace($ProjectRoot, "").TrimStart('\').Replace('\','_')
    Copy-Item $_.FullName "$envDir\$dest"
}
Get-ChildItem -Recurse -Filter "*.env.production.example" | ForEach-Object {
    $dest = $_.FullName.Replace($ProjectRoot, "").TrimStart('\').Replace('\','_')
    Copy-Item $_.FullName "$envDir\$dest"
}
Write-OK "Env templates saved (no real secrets)"

# ── 6. Documentation backup ───────────────────────────────────────────────
Write-Step "Backing up documentation"
$docsDir = "$BackupDir\docs"
New-Item -ItemType Directory -Path $docsDir -Force | Out-Null

Get-ChildItem -Recurse -Filter "*.md" | Where-Object {
    $_.FullName -notmatch '\\node_modules\\' -and
    $_.FullName -notmatch '\\.git\\'
} | ForEach-Object {
    $relativePath = $_.FullName.Substring($ProjectRoot.Length + 1).Replace('\','_')
    Copy-Item $_.FullName "$docsDir\$relativePath"
}
Write-OK "Markdown docs backed up"

# ── 7. GitHub Actions workflows ───────────────────────────────────────────
if (Test-Path ".github\workflows") {
    Copy-Item ".github\workflows" "$BackupDir\github-workflows" -Recurse
    Write-OK "GitHub Actions workflows saved"
}

# ── 8. Create full source archive ─────────────────────────────────────────
Write-Step "Creating full source archive (excluding build artifacts)"

$ArchiveFile = "$BackupDir\halqa_full_$Timestamp.zip"

$ExcludePatterns = @(
    '\node_modules\', '\.next\', '\dist\', '\build\', '\out\',
    '\.git\', '\logs\', '\coverage\', '\__pycache__\',
    '\.expo\', '\android\build\', '\ios\build\',
    '\uploads\audio\', '\uploads\avatars\', '\uploads\media\',
    '.apk', '.aab', '.log', '.pyc'
)

$files = Get-ChildItem -Path $ProjectRoot -Recurse -File | Where-Object {
    $rel = $_.FullName.Substring($ProjectRoot.Length)
    $excluded = $false
    foreach ($pat in $ExcludePatterns) {
        if ($rel -like "*$pat*") { $excluded = $true; break }
    }
    -not $excluded
}

Add-Type -Assembly 'System.IO.Compression.FileSystem'
if (Test-Path $ArchiveFile) { Remove-Item $ArchiveFile -Force }

$zip = [System.IO.Compression.ZipFile]::Open($ArchiveFile, 'Create')
$files | ForEach-Object {
    $relative = $_.FullName.Substring($ProjectRoot.Length + 1)
    try {
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
            $zip, $_.FullName, $relative,
            [System.IO.Compression.CompressionLevel]::Optimal
        ) | Out-Null
    } catch { }
}
$zip.Dispose()

$archiveMB = [math]::Round((Get-Item $ArchiveFile).Length / 1MB, 1)
Write-OK "Full archive: $ArchiveFile ($archiveMB MB, $($files.Count) files)"

# ── 9. Cleanup old weekly backups (keep 12 weeks = 3 months) ─────────────
Write-Step "Cleaning old weekly backups"
$cutoff = (Get-Date).AddDays(-84)
Get-ChildItem -Path $BackupRoot -Directory | Where-Object {
    $_.LastWriteTime -lt $cutoff
} | ForEach-Object {
    Remove-Item $_.FullName -Recurse -Force
    Write-WARN "Removed: $($_.Name)"
}
Write-OK "Kept last 12 weeks of weekly backups"

# ── Summary ───────────────────────────────────────────────────────────────
Write-Host @"

═══════════════════════════════════════════════════════════════════════════════
  Weekly Backup Complete
  Location: $BackupDir
═══════════════════════════════════════════════════════════════════════════════

  Contents:
    📦 halqa_full_$Timestamp.zip     — full source archive
    🗄  halqa_db_full_$Timestamp.sql  — MySQL dump (restore-ready)
    📋 prisma\                        — schema + migrations
    📋 packages\                      — all package.json + locks
    📋 env-templates\                 — .env.example files
    📋 docs\                          — all .md files
    📋 git-history.txt                — commit graph
    📋 git-commits.csv                — commit log (importable)

  Copy this folder to:
    - External hard drive
    - USB drive
    - OneDrive / Google Drive / Dropbox
    - Second machine
═══════════════════════════════════════════════════════════════════════════════
"@ -ForegroundColor Green
