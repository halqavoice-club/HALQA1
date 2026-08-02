# ============================================================================
# XAMPP MySQL Corruption Fix Script
# ============================================================================
# Problem: "Can't open and lock privilege tables: Incorrect file format 'proxies_priv'"
# Cause: System table corruption in mysql database
# Solution: Repair system tables using mysql_upgrade
# ============================================================================

Write-Host "=== XAMPP MySQL Corruption Fix ===" -ForegroundColor Cyan
Write-Host ""

# Step 1: Stop conflicting MySQL services
Write-Host "[1/5] Stopping conflicting MySQL services..." -ForegroundColor Yellow
$services = @('mysql10', 'wampmysqld', 'mysql', 'MySQL80', 'MySQL')
foreach ($svc in $services) {
    $service = Get-Service -Name $svc -ErrorAction SilentlyContinue
    if ($service -and $service.Status -eq 'Running') {
        Write-Host "  Stopping $svc..." -ForegroundColor Gray
        Stop-Service -Name $svc -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
    }
}

# Step 2: Kill any remaining mysqld processes
Write-Host "[2/5] Killing any remaining MySQL processes..." -ForegroundColor Yellow
Get-Process mysqld -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

# Step 3: Start XAMPP MySQL in safe mode (skip grant tables)
Write-Host "[3/5] Starting XAMPP MySQL in safe mode..." -ForegroundColor Yellow
$xamppMysqlBin = "C:\xampp\mysql\bin"
$dataDir = "C:\xampp\mysql\data"

if (-not (Test-Path $xamppMysqlBin)) {
    Write-Host "ERROR: XAMPP MySQL not found at $xamppMysqlBin" -ForegroundColor Red
    exit 1
}

# Start MySQL with --skip-grant-tables to bypass corrupted privilege tables
$mysqlProcess = Start-Process -FilePath "$xamppMysqlBin\mysqld.exe" `
    -ArgumentList "--console --skip-grant-tables --datadir=$dataDir" `
    -WindowStyle Hidden `
    -PassThru

Write-Host "  Waiting for MySQL to start..." -ForegroundColor Gray
Start-Sleep -Seconds 5

# Step 4: Run mysql_upgrade to repair system tables
Write-Host "[4/5] Running mysql_upgrade to repair system tables..." -ForegroundColor Yellow
$upgradeOutput = & "$xamppMysqlBin\mysql_upgrade.exe" --force 2>&1
Write-Host $upgradeOutput -ForegroundColor Gray

# Step 5: Restart MySQL normally
Write-Host "[5/5] Restarting MySQL normally..." -ForegroundColor Yellow
Stop-Process -Id $mysqlProcess.Id -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3

Write-Host ""
Write-Host "=== Fix Complete ===" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "1. Open XAMPP Control Panel" -ForegroundColor White
Write-Host "2. Click 'Start' on MySQL" -ForegroundColor White
Write-Host "3. If it still fails, run this alternative fix:" -ForegroundColor White
Write-Host "   cd C:\xampp\mysql\bin" -ForegroundColor Yellow
Write-Host "   .\mysql_install_db.exe --datadir=C:\xampp\mysql\data" -ForegroundColor Yellow
Write-Host ""
