$ErrorActionPreference = 'Stop'

$projectDir = 'H:\OFFICE PROJECTS\PDF EDITOR'
$nodeDir = 'C:\nvm4w\nodejs'
$appName = 'bcim-pdf-toolkit-web'

if (Test-Path $nodeDir) {
  $env:Path = "$nodeDir;$env:Path"
}

Set-Location $projectDir

pm2 describe $appName *> $null
if ($LASTEXITCODE -eq 0) {
  pm2 restart $appName --update-env
} else {
  pm2 start ecosystem.config.cjs --update-env
}

pm2 save
pm2 status $appName
