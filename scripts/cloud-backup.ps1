# ═══════════════════════════════════════════════════════════════════════════════
# HALQA — Cloud Backup Script
# Uploads backup archives to Google Drive or OneDrive using rclone.
#
# SETUP (run once):
#   1. Install rclone: https://rclone.org/downloads/  (or: winget install Rclone.Rclone)
#   2. Configure remote:
#      rclone config
#      → Choose: n (new remote)
#      → Name: halqa-gdrive  (or halqa-onedrive)
#      → Type: drive (Google Drive) or onedrive (OneDrive)
#      → Follow the auth flow in your browser
#   3. Run this script: .\scripts\cloud-backup.ps1
#
# USAGE:
#   .\scripts\cloud-backup.ps1                          # uploads today's backup
#   .\scripts\cloud-backup.ps1 -Remote "halqa-onedrive" # use OneDrive instead
# ═══════════════════════════════════════════════════════════════════════════════

param(
    [string]$Remote       = "halqa-gdrive",      # rclone remote name
    [string]$RemotePath   = "HALQA-Backups",     # folder in cloud storage
    [string]$LocalBackups = "$env:USERPROFILE\Desktop\HALQA-Backups",
    [switch]$DryRun                               # test without uploading
)

$ErrorActionPreference = "Continue"

function Write-Step([string]$m) { Write-Host "`n[$m]" -ForegroundColor Cyan }
function Write-OK([string]$m)   { Write-Host "  ✅ $m" -ForegroundColor Green }
function Write-WARN([string]$m) { Write-Host "  ⚠  $m" -ForegroundColor Yellow }
function Write-ERR([string]$m)  { Write-Host "  ❌ $m" -ForegroundColor Red }

Write-Host @"
═══════════════════════════════════════════════════════════════════════════════
  HALQA Cloud Backup — $(Get-Date -Format 'yyyy-MM-dd HH:mm')
  Remote: $Remote → $RemotePath
═══════════════════════════════════════════════════════════════════════════════
"@ -ForegroundColor Cyan

# ── Check rclone installed ─────────────────────────────────────────────────
Write-Step "Checking rclone"
$rclone = Get-Command rclone -ErrorAction SilentlyContinue
if (-not $rclone) {
    Write-ERR "rclone not found."
    Write-Host @"

  Install rclone (choose one):

  Option A — winget (easiest):
    winget install Rclone.Rclone

  Option B — manual:
    1. Download from https://rclone.org/downloads/
    2. Extract rclone.exe to C:\Windows\System32\

  After installing, configure your cloud remote:
    rclone config
"@ -ForegroundColor Yellow
    exit 1
}
Write-OK "rclone found: $(rclone version 2>&1 | Select-Object -First 1)"

# ── Check remote is configured ─────────────────────────────────────────────
Write-Step "Checking remote '$Remote'"
$remotes = rclone listremotes 2>&1
if ($remotes -notmatch $Remote) {
    Write-ERR "Remote '$Remote' not configured in rclone."
    Write-Host @"

  Configure it now:
    rclone config
    → n (new remote)
    → Name: $Remote
    → Type: drive (Google Drive) or onedrive (Microsoft OneDrive)
    → Follow browser auth

  Available remotes: $remotes
"@ -ForegroundColor Yellow
    exit 1
}
Write-OK "Remote '$Remote' is configured"

# ── Check local backups exist ──────────────────────────────────────────────
Write-Step "Checking local backups"
if (-not (Test-Path $LocalBackups)) {
    Write-ERR "Local backup folder not found: $LocalBackups"
    Write-WARN "Run backup-daily.ps1 first to create backups"
    exit 1
}

$folders = Get-ChildItem $LocalBackups -Directory | Sort-Object Name -Descending
Write-OK "Found $($folders.Count) backup folder(s) in $LocalBackups"

# ── Upload today's backup ──────────────────────────────────────────────────
Write-Step "Uploading to $Remote`:$RemotePath"

$today = Get-Date -Format "yyyy-MM-dd"
$todayFolder = $folders | Where-Object { $_.Name -like "$today*" -or $_.Name -eq $today } | Select-Object -First 1

if ($todayFolder) {
    Write-Host "  Uploading: $($todayFolder.Name)" -ForegroundColor Gray
    
    $rcloneArgs = @(
        "copy",
        $todayFolder.FullName,
        "${Remote}:${RemotePath}/$($todayFolder.Name)",
        "--progress",
        "--transfers", "4",
        "--retries", "3"
    )
    if ($DryRun) { $rcloneArgs += "--dry-run" }
    
    & rclone @rcloneArgs
    
    if ($LASTEXITCODE -eq 0) {
        Write-OK "Today's backup uploaded: $($todayFolder.Name)"
    } else {
        Write-ERR "Upload failed (exit code $LASTEXITCODE)"
    }
} else {
    Write-WARN "No backup found for today ($today) — uploading most recent"
    $latest = $folders | Select-Object -First 1
    if ($latest) {
        $rcloneArgs = @("copy", $latest.FullName, "${Remote}:${RemotePath}/$($latest.Name)", "--progress")
        if ($DryRun) { $rcloneArgs += "--dry-run" }
        & rclone @rcloneArgs
        Write-OK "Uploaded: $($latest.Name)"
    }
}

# ── Sync weekly backups ────────────────────────────────────────────────────
$weeklyPath = "$LocalBackups\weekly"
if (Test-Path $weeklyPath) {
    Write-Step "Syncing weekly backups"
    $rcloneArgs = @(
        "sync",
        $weeklyPath,
        "${Remote}:${RemotePath}\weekly",
        "--progress",
        "--transfers", "2"
    )
    if ($DryRun) { $rcloneArgs += "--dry-run" }
    & rclone @rcloneArgs
    Write-OK "Weekly backups synced"
}

# ── Verify upload ──────────────────────────────────────────────────────────
Write-Step "Verifying cloud storage"
Write-Host "  Files in ${Remote}:${RemotePath}:"
rclone lsd "${Remote}:${RemotePath}" 2>&1 | Select-Object -Last 10 | ForEach-Object {
    Write-Host "    $_" -ForegroundColor Gray
}

# ── Summary ───────────────────────────────────────────────────────────────
Write-Host @"

═══════════════════════════════════════════════════════════════════════════════
  Cloud Backup Complete
  View your files:
    Google Drive : https://drive.google.com  → HALQA-Backups folder
    OneDrive     : https://onedrive.live.com → HALQA-Backups folder
═══════════════════════════════════════════════════════════════════════════════
"@ -ForegroundColor Green
