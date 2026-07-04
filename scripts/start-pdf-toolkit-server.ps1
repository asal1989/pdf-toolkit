$ErrorActionPreference = 'Stop'

$projectDir = 'H:\OFFICE PROJECTS\PDF EDITOR'
$nodeDir = 'C:\nvm4w\nodejs'

if (Test-Path $nodeDir) {
  $env:Path = "$nodeDir;$env:Path"
}

Set-Location $projectDir

pm2 start ecosystem.config.cjs --update-env
pm2 save
