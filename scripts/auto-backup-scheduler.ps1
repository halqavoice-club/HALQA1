# ═══════════════════════════════════════════════════════════════════════════════
# HALQA — Automated Backup Scheduler
# Registers a Windows Task Scheduler job that runs backup-daily.ps1
# automatically every day at the time you choose.
#
# Run ONCE as Administrator:
#   .\scripts\auto-backup-scheduler.ps1
#
# To remove the scheduled task:
#   Unregister-ScheduledTask -TaskName "HALQA-Daily-Backup" -Confirm:$false
# ═══════════════════════════════════════════════════════════════════════════════

param(
    [string]$RunAtTime = "23:00",   # default: 11pm every night
    [string]$TaskName  = "HALQA-Daily-Backup"
)

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$BackupScript = Join-Path $ProjectRoot "scripts\backup-daily.ps1"

# ── Check admin rights ─────────────────────────────────────────────────────
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "❌ Must run as Administrator. Right-click PowerShell → Run as Administrator" -ForegroundColor Red
    exit 1
}

Write-Host "`n[HALQA Auto Backup Scheduler]" -ForegroundColor Cyan

# ── Remove existing task if present ───────────────────────────────────────
$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "  ♻  Removed existing task" -ForegroundColor Yellow
}

# ── Build the scheduled task ───────────────────────────────────────────────
$action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$BackupScript`" -Message `"chore(backup): automated nightly backup`"" `
    -WorkingDirectory $ProjectRoot

$trigger = New-ScheduledTaskTrigger -Daily -At $RunAtTime

$settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit (New-TimeSpan -Hours 1) `
    -RestartCount 2 `
    -RestartInterval (New-TimeSpan -Minutes 5) `
    -StartWhenAvailable `
    -RunOnlyIfNetworkAvailable

# FIX: Use S4U logon type so the task runs even when the user is NOT logged in.
# Previously LogonType was "Interactive" which means the backup never runs on
# an unattended server or when the PC is locked. S4U (Service For User) runs
# the task under the current user account without requiring an active session.
$principal = New-ScheduledTaskPrincipal `
    -UserId $env:USERNAME `
    -LogonType S4U `
    -RunLevel Highest

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Description "HALQA daily backup: git commit + MySQL export + zip archive" `
    -Force

Write-Host @"

  ✅ Scheduled task created!

  Task name : $TaskName
  Runs at   : $RunAtTime every day
  Script    : $BackupScript

  To check task status:
    Get-ScheduledTask -TaskName "$TaskName"

  To run it now manually:
    Start-ScheduledTask -TaskName "$TaskName"

  To view last run result:
    (Get-ScheduledTaskInfo -TaskName "$TaskName").LastTaskResult

  To remove:
    Unregister-ScheduledTask -TaskName "$TaskName" -Confirm:`$false
"@ -ForegroundColor Green
