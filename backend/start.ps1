# HALQA Backend — Start with adequate heap
# Run this instead of 'npm run dev' to avoid memory issues
# Usage: powershell -ExecutionPolicy Bypass -File start.ps1

Write-Host "Starting HALQA backend with 512MB heap..." -ForegroundColor Cyan
$env:NODE_ENV = "development"

# Load .env
Get-Content ".env" | ForEach-Object {
    if ($_ -match '^([^#=]+)=(.*)$') {
        $key = $matches[1].Trim()
        $val = $matches[2].Trim().Trim('"')
        [System.Environment]::SetEnvironmentVariable($key, $val, "Process")
    }
}

npx nodemon --config nodemon.json src/app.js
