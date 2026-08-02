# HALQA — Setup ngrok tunnel for APK backend access
# Run this BEFORE building APK or before scanning QR with physical device

Write-Host "Starting ngrok tunnel for HALQA backend (port 5000)..."
Write-Host ""
Write-Host "Make sure your backend is running first:"
Write-Host '  cd backend && node src/app.js'
Write-Host ""

# Check if ngrok is available
$ngrokPath = Get-Command ngrok -ErrorAction SilentlyContinue
if (-not $ngrokPath) {
  Write-Host "ngrok not found. Install from: https://ngrok.com/download"
  Write-Host "Or run: choco install ngrok"
  exit 1
}

Write-Host "Opening tunnel on port 5000..."
Write-Host "Once you see the Forwarding URL (https://xxxx.ngrok.io):"
Write-Host "1. Copy the https URL"
Write-Host "2. Update mobile/.env:"
Write-Host "   EXPO_PUBLIC_API_URL=https://xxxx.ngrok.io/api/v1"
Write-Host "   EXPO_PUBLIC_SOCKET_URL=https://xxxx.ngrok.io"
Write-Host "3. Then run: eas build --platform android --profile preview"
Write-Host ""

ngrok http 5000
