# ═══════════════════════════════════════════════════════════════════════════════
# HALQA — Cloud Backup Setup (Google Drive)
# Run this ONCE to connect rclone to your Google Drive.
# After setup, run cloud-backup.ps1 to upload backups.
# ═══════════════════════════════════════════════════════════════════════════════

$RcloneExe = "C:\Users\hp\AppData\Local\Microsoft\WinGet\Packages\Rclone.Rclone_Microsoft.Winget.Source_8wekyb3d8bbwe\rclone-v1.75.0-windows-amd64\rclone.exe"

Write-Host @"
═══════════════════════════════════════════════════════════════════════════════
  HALQA Cloud Backup Setup — Google Drive
═══════════════════════════════════════════════════════════════════════════════

  This will open rclone config. Follow these steps EXACTLY:

  1. Press 'n' then ENTER           → new remote
  2. Type 'halqa-gdrive' ENTER      → name it
  3. Type 'drive' ENTER             → Google Drive
  4. Press ENTER (skip client_id)
  5. Press ENTER (skip client_secret)
  6. Type '1' ENTER                 → full access
  7. Press ENTER (skip root folder)
  8. Press ENTER (skip service account)
  9. Type 'n' ENTER                 → no advanced config
  10. Type 'y' ENTER                → use auto config (opens browser)
  11. Browser opens → login to Google → Allow rclone access
  12. Type 'n' ENTER                → not a shared drive
  13. Type 'y' ENTER                → confirm settings
  14. Type 'q' ENTER                → quit config

  A browser window will open automatically for Google login.

═══════════════════════════════════════════════════════════════════════════════
"@ -ForegroundColor Cyan

Write-Host "  Press ENTER to start rclone config..." -ForegroundColor Yellow
Read-Host

# Run rclone config interactively
& $RcloneExe config

# Test the connection
Write-Host "`n[Testing Google Drive connection]" -ForegroundColor Cyan
$test = & $RcloneExe lsd "halqa-gdrive:" 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "  ✅ Google Drive connected successfully!" -ForegroundColor Green
    Write-Host "  Your Drive folders:" -ForegroundColor Gray
    $test | Select-Object -First 5 | ForEach-Object { Write-Host "    $_" -ForegroundColor Gray }

    # Create the HALQA-Backups folder
    & $RcloneExe mkdir "halqa-gdrive:HALQA-Backups" 2>&1
    Write-Host "  ✅ Created HALQA-Backups folder in Google Drive" -ForegroundColor Green

    Write-Host @"

═══════════════════════════════════════════════════════════════════════════════
  Setup Complete!

  Now run your first cloud backup:
    .\scripts\cloud-backup.ps1

  Your backups will appear at:
    Google Drive → HALQA-Backups folder
    https://drive.google.com
═══════════════════════════════════════════════════════════════════════════════
"@ -ForegroundColor Green
} else {
    Write-Host "  ❌ Connection test failed. Re-run this script and try again." -ForegroundColor Red
    Write-Host "  Error: $test" -ForegroundColor Yellow
}
