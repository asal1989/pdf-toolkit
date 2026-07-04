$ErrorActionPreference = 'Continue'

$nodeDir = 'C:\nvm4w\nodejs'
if (Test-Path $nodeDir) {
  $env:Path = "$nodeDir;$env:Path"
}

pm2 status bcim-pdf-toolkit-web

try {
  $response = Invoke-WebRequest -UseBasicParsing http://127.0.0.1:5173/health.json -TimeoutSec 8
  "Health: HTTP $($response.StatusCode)"
  $response.Content
} catch {
  "Health check failed: $($_.Exception.Message)"
  exit 1
}
