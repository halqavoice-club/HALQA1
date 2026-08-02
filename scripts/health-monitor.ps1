# ═══════════════════════════════════════════════════════════════════════════════
# HALQA — Production Health Monitor & Alert Script
# Checks backend health, database, Redis, and sends alerts on failure.
#
# Usage:
#   .\scripts\health-monitor.ps1 -ApiUrl "https://api.halqa.app"
#   .\scripts\health-monitor.ps1 -ApiUrl "http://localhost:5000" -AlertEmail "you@email.com"
#
# Schedule with Task Scheduler for continuous monitoring:
#   Trigger: Every 5 minutes
# ═══════════════════════════════════════════════════════════════════════════════

param(
    [string]$ApiUrl      = "http://localhost:5000",
    [string]$AlertEmail  = "",          # set to receive email alerts
    [string]$SmtpHost    = "",
    [string]$SmtpUser    = "",
    [string]$SmtpPass    = "",
    [int]   $TimeoutSec  = 10,
    [string]$LogFile     = "$env:USERPROFILE\Desktop\HALQA-Backups\health.log"
)

$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
$issues    = @()

function Write-Log([string]$msg, [string]$level = "INFO") {
    $entry = "[$timestamp] [$level] $msg"
    Add-Content -Path $LogFile -Value $entry -ErrorAction SilentlyContinue
    switch ($level) {
        "OK"    { Write-Host "  ✅ $msg" -ForegroundColor Green }
        "WARN"  { Write-Host "  ⚠  $msg" -ForegroundColor Yellow }
        "ERROR" { Write-Host "  ❌ $msg" -ForegroundColor Red }
        default { Write-Host "  $msg" -ForegroundColor Gray }
    }
}

Write-Host "`n[HALQA Health Monitor — $timestamp]" -ForegroundColor Cyan

# ── 1. Backend health endpoint ─────────────────────────────────────────────
try {
    $resp = Invoke-RestMethod -Uri "$ApiUrl/health" -TimeoutSec $TimeoutSec -ErrorAction Stop
    if ($resp.status -eq "ok") {
        Write-Log "Backend: healthy (uptime: $([math]::Round($resp.uptime/3600,1))h)" "OK"
    } else {
        Write-Log "Backend: unhealthy response: $($resp | ConvertTo-Json -Compress)" "WARN"
        $issues += "Backend returned non-ok status"
    }
} catch {
    Write-Log "Backend: UNREACHABLE at $ApiUrl/health — $_" "ERROR"
    $issues += "Backend unreachable"
}

# ── 2. Database check ──────────────────────────────────────────────────────
try {
    $db = Invoke-RestMethod -Uri "$ApiUrl/health/db" -TimeoutSec $TimeoutSec -ErrorAction SilentlyContinue
    if ($db) {
        Write-Log "Database: connected" "OK"
    }
} catch {
    # Some setups don't have /health/db — check via main health endpoint
    Write-Log "Database: health endpoint not available (check manually)" "WARN"
}

# ── 3. Metrics endpoint ────────────────────────────────────────────────────
try {
    $metrics = Invoke-WebRequest -Uri "$ApiUrl/metrics" -TimeoutSec $TimeoutSec -ErrorAction SilentlyContinue
    if ($metrics.StatusCode -eq 200) {
        Write-Log "Metrics: endpoint responding" "OK"
    }
} catch {
    Write-Log "Metrics: not accessible (may require METRICS_TOKEN)" "WARN"
}

# ── 4. Local MySQL check ───────────────────────────────────────────────────
$mysqldumps = @("C:\xampp\mysql\bin\mysql.exe", "mysql")
foreach ($mysql in $mysqldumps) {
    $cmd = if ($mysql -eq "mysql") { Get-Command mysql -ErrorAction SilentlyContinue } else { $mysql }
    if ($cmd -and (Test-Path ($mysql -replace '^mysql$', ''))) {
        try {
            $result = & $mysql -u root -e "SELECT 1" halqa_db 2>&1
            if ($result -match "1") {
                Write-Log "MySQL: connected to halqa_db" "OK"
            }
        } catch { }
        break
    }
}

# ── 5. Disk space check ────────────────────────────────────────────────────
$drive = Get-PSDrive C -ErrorAction SilentlyContinue
if ($drive) {
    $freeGB = [math]::Round($drive.Free / 1GB, 1)
    $usedGB = [math]::Round($drive.Used / 1GB, 1)
    if ($freeGB -lt 5) {
        Write-Log "Disk: LOW — only ${freeGB}GB free on C: drive" "ERROR"
        $issues += "Disk space critical: ${freeGB}GB free"
    } elseif ($freeGB -lt 20) {
        Write-Log "Disk: ${freeGB}GB free (warning — consider cleanup)" "WARN"
    } else {
        Write-Log "Disk: ${freeGB}GB free on C:" "OK"
    }
}

# ── 6. Backup freshness check ──────────────────────────────────────────────
$backupDir = "$env:USERPROFILE\Desktop\HALQA-Backups"
if (Test-Path $backupDir) {
    $latestBackup = Get-ChildItem $backupDir -Directory | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($latestBackup) {
        $ageHours = [math]::Round(((Get-Date) - $latestBackup.LastWriteTime).TotalHours, 1)
        if ($ageHours -gt 48) {
            Write-Log "Backup: STALE — last backup ${ageHours}h ago ($($latestBackup.Name))" "ERROR"
            $issues += "No backup in 48 hours"
        } elseif ($ageHours -gt 25) {
            Write-Log "Backup: ${ageHours}h ago — consider running backup" "WARN"
        } else {
            Write-Log "Backup: fresh — ${ageHours}h ago ($($latestBackup.Name))" "OK"
        }
    }
} else {
    Write-Log "Backup: no backup folder found" "WARN"
}

# ── 7. Git sync check ──────────────────────────────────────────────────────
$projectRoot = Split-Path -Parent $PSScriptRoot
if (Test-Path "$projectRoot\.git") {
    try {
        $unpushed = git -C $projectRoot log origin/main..HEAD --oneline 2>&1
        if ($unpushed -and $unpushed -notmatch "fatal") {
            $count = ($unpushed | Measure-Object -Line).Lines
            Write-Log "Git: $count unpushed commit(s) on main" "WARN"
        } else {
            Write-Log "Git: main is up to date with GitHub" "OK"
        }
    } catch { }
}

# ── Send alert if issues found ─────────────────────────────────────────────
if ($issues.Count -gt 0 -and $AlertEmail -and $SmtpHost) {
    $subject = "🚨 HALQA Alert — $($issues.Count) issue(s) detected"
    $body = @"
HALQA Health Monitor Alert
Time: $timestamp
Server: $ApiUrl

Issues detected:
$($issues | ForEach-Object { "• $_" } | Out-String)

Check your server and logs immediately.
"@
    try {
        $cred = New-Object System.Management.Automation.PSCredential($SmtpUser, (ConvertTo-SecureString $SmtpPass -AsPlainText -Force))
        Send-MailMessage -To $AlertEmail -From $SmtpUser -Subject $subject -Body $body `
            -SmtpServer $SmtpHost -Port 587 -UseSsl -Credential $cred
        Write-Log "Alert email sent to $AlertEmail" "OK"
    } catch {
        Write-Log "Failed to send alert email: $_" "WARN"
    }
}

# ── Summary ────────────────────────────────────────────────────────────────
Write-Host ""
if ($issues.Count -eq 0) {
    Write-Host "  🟢 All systems healthy" -ForegroundColor Green
} else {
    Write-Host "  🔴 $($issues.Count) issue(s) need attention:" -ForegroundColor Red
    $issues | ForEach-Object { Write-Host "     • $_" -ForegroundColor Yellow }
}
Write-Host "  Log: $LogFile`n"
