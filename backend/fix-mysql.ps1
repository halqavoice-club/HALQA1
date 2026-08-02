# fix-mysql.ps1 — Run this when MySQL won't start
# Usage: powershell -ExecutionPolicy Bypass -File fix-mysql.ps1

Write-Host "🔧 Halqa MySQL Fix Script" -ForegroundColor Cyan
Write-Host ""

# Step 1: Stop MySQL
Write-Host "1. Stopping MySQL..." -ForegroundColor Yellow
Stop-Process -Name "mysqld" -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
Write-Host "   Done" -ForegroundColor Green

# Step 2: Restore proxies_priv from backup
Write-Host "2. Restoring proxies_priv from backup..." -ForegroundColor Yellow
$dataDir   = "C:\xampp\mysql\data\mysql"
$backupDir = "C:\xampp\mysql\backup\mysql"

foreach ($ext in @("frm", "MAD", "MAI")) {
    $src  = "$backupDir\proxies_priv.$ext"
    $dest = "$dataDir\proxies_priv.$ext"
    if (Test-Path $src) {
        Copy-Item $src $dest -Force
        Write-Host "   Restored proxies_priv.$ext" -ForegroundColor Green
    } else {
        Write-Host "   WARNING: $src not found" -ForegroundColor Red
    }
}

# Remove any .BAK files
Get-ChildItem $dataDir -Filter "proxies_priv*.BAK" | Remove-Item -Force
Write-Host "   Cleaned up .BAK files" -ForegroundColor Green

# Step 3: Start MySQL
Write-Host "3. Starting MySQL..." -ForegroundColor Yellow
Start-Process "C:\xampp\mysql\bin\mysqld.exe" -ArgumentList "--defaults-file=C:\xampp\mysql\bin\my.ini" -WindowStyle Hidden
Start-Sleep -Seconds 5

# Step 4: Verify
$listening = netstat -ano | Select-String ":3306"
if ($listening) {
    Write-Host "   MySQL is running on port 3306 ✅" -ForegroundColor Green
} else {
    Write-Host "   MySQL did NOT start. Check C:\xampp\mysql\data\mysql_error.log" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "✅ MySQL fixed! Now run: cd backend && npm run dev" -ForegroundColor Cyan
