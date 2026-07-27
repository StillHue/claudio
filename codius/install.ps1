param(
  [switch]$SkipProviderCheck,
  [switch]$SkipPathShim
)

$ErrorActionPreference = 'Stop'
$HERE = Split-Path -Parent $PSCommandPath
$HOME_DIR = [System.Environment]::GetFolderPath('UserProfile')

Write-Host "=== codius installer ===" -ForegroundColor Cyan

# 1. Check provider config (shared with claude-wrapper)
$ProvidersFile = "$HOME_DIR\.claude-native\providers.json"
if (-not $SkipProviderCheck) {
  if (Test-Path $ProvidersFile) {
    $cfg = Get-Content $ProvidersFile -Raw | ConvertFrom-Json
    $active = $cfg.active
    if ($active -and $cfg.providers.$active.apiKey) {
      Write-Host "provider: $active (key found)" -ForegroundColor Green
    } else {
      Write-Host "provider $active has no apiKey — set one via /provider or edit $ProvidersFile" -ForegroundColor Yellow
    }
  } else {
    $fallback = "$HOME_DIR\.codius\providers.json"
    if (Test-Path $fallback) {
      Write-Host "using fallback $fallback" -ForegroundColor Yellow
      $ProvidersFile = $fallback
    } else {
      Write-Host "no providers.json found — create one at $ProvidersFile" -ForegroundColor Yellow
      $null = New-Item -ItemType Directory -Path "$HOME_DIR\.claude-native" -Force
      @'
{ "active": "opencode", "providers": { "opencode": { "baseUrl": "https://opencode.ai/zen/v1", "model": "deepseek-v4-flash-free", "apiKeyEnv": "OPENAI_API_KEY", "tools": true, "models": ["deepseek-v4-flash-free","big-pickle","mimo-v2.5-free","north-mini-code-free","laguna-s-2.1-free","nemotron-3-ultra-free"] } } }
'@ | Set-Content $ProvidersFile -Encoding utf8
    }
  }
}

# 2. Install PATH shim
if (-not $SkipPathShim) {
  $NpmDir = "$HOME_DIR\AppData\Roaming\npm"
  if (Test-Path $NpmDir) {
    $Shim = "$NpmDir\codius.cmd"
    @"
@ECHO off
SET "HERE=$HERE"
node "%HERE%codius-wrapper.js" %*
EXIT /B %ERRORLEVEL%
"@ | Set-Content $Shim -Encoding utf8
    Write-Host "shim installed: $Shim" -ForegroundColor Green
  } else {
    Write-Host "npm bin dir not found, skipping PATH shim" -ForegroundColor Yellow
  }
}

Write-Host ""
Write-Host "codius ready!" -ForegroundColor Cyan
Write-Host "  codius bridge    — start proxy on port 4890"
Write-Host "  codius launch    — launch Codex through proxy"
Write-Host "  codius status    — diagnostics"
Write-Host ""
Write-Host "Set Codex config to model=codius/proxy and set HTTPS_PROXY=http://127.0.0.1:4890"
Write-Host "Or: codius launch to auto-configure env"
