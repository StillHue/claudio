#Requires -Version 5.1
<#
.SYNOPSIS
  One-click setup: official Claude Code + local bridge (JS) + IDE hosts.

.DESCRIPTION
  From a checkout with claude-wrapper/:

    powershell -ExecutionPolicy Bypass -File .\claude-wrapper\install.ps1

  What it does:
    1. Ensures official Claude Code (if missing)
    2. Deploys wrapper under ~/.claude/wrapper
    3. Points IDE hosts at claude-wrapper.exe
    4. Installs PATH shims (claude)
    5. Centralizes providers.json / .env under ~/.claude
.PARAMETER SkipClaudeInstall
  Do not run Anthropic's install.ps1 even if claude.exe is missing.
#>
[CmdletBinding()]
param(
  [switch]$SkipClaudeInstall
)

$ErrorActionPreference = 'Stop'
$here = (Resolve-Path (Split-Path -Parent $MyInvocation.MyCommand.Path)).Path
Set-Location $here

function Write-Step([string]$msg) {
  Write-Host ""
  Write-Host "==> $msg" -ForegroundColor Cyan
}

function Test-ClaudeBinary {
  $candidates = @(
    (Join-Path $env:USERPROFILE '.local\bin\claude.exe'),
    (Join-Path $env:LOCALAPPDATA 'claude\claude.exe')
  )
  foreach ($c in $candidates) {
    if (Test-Path $c) { return $c }
  }
  $cmd = Get-Command claude.exe -ErrorAction SilentlyContinue
  if ($cmd -and $cmd.Source -like '*.exe') { return $cmd.Source }
  $extRoots = @(
    (Join-Path $env:USERPROFILE '.cursor\extensions'),
    (Join-Path $env:USERPROFILE '.vscode\extensions'),
    (Join-Path $env:USERPROFILE '.vscode-insiders\extensions')
  )
  foreach ($extRoot in $extRoots) {
    if (-not (Test-Path $extRoot)) { continue }
    $hit = Get-ChildItem $extRoot -Directory -Filter 'anthropic.claude-code-*' -ErrorAction SilentlyContinue |
      Sort-Object Name -Descending |
      ForEach-Object {
        $p = Join-Path $_.FullName 'resources\native-binary\claude.exe'
        if (Test-Path $p) { $p }
      } |
      Select-Object -First 1
    if ($hit) { return $hit }
  }
  return $null
}

function Ensure-ClaudeCode {
  $existing = Test-ClaudeBinary
  if ($existing) {
    Write-Host "Claude Code found: $existing"
    return $existing
  }
  if ($SkipClaudeInstall) {
    Write-Warning "Claude Code binary not found and -SkipClaudeInstall was set."
    return $null
  }
  Write-Step "Installing official Claude Code..."
  try {
    irm https://claude.ai/install.ps1 | iex
  } catch {
    Write-Warning "Official install failed: $($_.Exception.Message)"
    Write-Warning "Install the Claude Code extension (Cursor or VS Code: anthropic.claude-code) or re-run install.ps1 later."
    return $null
  }
  return (Test-ClaudeBinary)
}

function Get-IdeSettingsTargets {
  $list = @()
  if ($env:APPDATA) {
    $list += @(
      @{ Name = 'Cursor'; Path = (Join-Path $env:APPDATA 'Cursor\User\settings.json') }
      @{ Name = 'VS Code'; Path = (Join-Path $env:APPDATA 'Code\User\settings.json') }
      @{ Name = 'VS Code Insiders'; Path = (Join-Path $env:APPDATA 'Code - Insiders\User\settings.json') }
      @{ Name = 'VSCodium'; Path = (Join-Path $env:APPDATA 'VSCodium\User\settings.json') }
    )
  }
  return $list
}

function Patch-IdeSettingsFile {
  param(
    [string]$Name,
    [string]$SettingsPath,
    [string]$ExePath
  )
  $dir = Split-Path $SettingsPath -Parent
  if (-not (Test-Path $dir)) {
    # Only create settings for IDEs that already have a product folder under APPDATA.
    $productRoot = Split-Path $dir -Parent
    if (-not (Test-Path $productRoot)) {
      Write-Host "skip $Name (not installed)"
      return $false
    }
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
  }
  if (-not (Test-Path $SettingsPath)) {
    Set-Content -Path $SettingsPath -Value "{}" -Encoding UTF8
  }

  Write-Host "Configuring $Name -> $SettingsPath"
  $node = Get-Command node -ErrorAction SilentlyContinue
  if ($node) {
    $patchJs = Join-Path $env:TEMP 'claudio-patch-ide-settings.js'
    $patchBody = @'
const fs = require('fs')
const settingsPath = process.argv[2]
const exe = process.argv[3]
function stripJsonc(raw) {
  let out = '', i = 0, inStr = false, quote = '', esc = false
  while (i < raw.length) {
    const c = raw[i], n = raw[i + 1]
    if (inStr) {
      out += c
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === quote) inStr = false
      i++
      continue
    }
    if (c === '"' || c === "'") { inStr = true; quote = c; out += c; i++; continue }
    if (c === '/' && n === '/') { while (i < raw.length && raw[i] !== '\n') i++; continue }
    if (c === '/' && n === '*') { i += 2; while (i + 1 < raw.length && !(raw[i] === '*' && raw[i + 1] === '/')) i++; i += 2; continue }
    out += c
    i++
  }
  return out
}
let raw = fs.readFileSync(settingsPath, 'utf8')
if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1)
let data
try { data = JSON.parse(raw) } catch (_) {
  try { data = JSON.parse(stripJsonc(raw)) } catch (e) {
    console.error('ERROR: could not parse settings.json (even after stripping comments).')
    console.error('Refusing to overwrite. Fix JSON manually, then re-run install.ps1.')
    console.error(String(e && e.message || e))
    process.exit(1)
  }
}
if (!data || typeof data !== 'object' || Array.isArray(data)) {
  console.error('ERROR: settings.json root must be an object. Refusing to overwrite.')
  process.exit(1)
}
fs.copyFileSync(settingsPath, settingsPath + '.bak-claudio-install')
data['claudeCode.claudeProcessWrapper'] = exe
if (data['claudeCode.skipApiCheck'] == null) data['claudeCode.skipApiCheck'] = true
if (data['claudeCode.disableLoginPrompt'] == null) data['claudeCode.disableLoginPrompt'] = true
data['claudeCode.model'] = data['claudeCode.model'] || 'anthropic.openrouter.openrouter-auto'
fs.writeFileSync(settingsPath, JSON.stringify(data, null, 2) + '\n', 'utf8')
console.log('set claudeCode.claudeProcessWrapper =', exe)
'@
    Set-Content -Path $patchJs -Value $patchBody -Encoding UTF8
    & node $patchJs $SettingsPath $ExePath
    if ($LASTEXITCODE -ne 0) {
      Write-Warning "Failed to patch $Name settings.json (exit $LASTEXITCODE). File left unchanged."
      return $false
    }
    Remove-Item $patchJs -Force -ErrorAction SilentlyContinue
    return $true
  }

  $json = Get-Content $SettingsPath -Raw -Encoding UTF8
  if ($json.Length -gt 0 -and [int][char]$json[0] -eq 0xFEFF) { $json = $json.Substring(1) }
  $obj = $null
  try { $obj = $json | ConvertFrom-Json } catch {
    Write-Warning "Could not parse $Name settings.json. Skipping (install Node.js for JSONC strip)."
    return $false
  }
  if ($null -eq $obj) {
    Write-Warning "$Name settings.json root is empty/null. Skipping."
    return $false
  }
  Copy-Item $SettingsPath "$SettingsPath.bak-claudio-install" -Force
  $obj | Add-Member -NotePropertyName 'claudeCode.claudeProcessWrapper' -NotePropertyValue $ExePath -Force
  if (-not ($obj.PSObject.Properties.Name -contains 'claudeCode.skipApiCheck')) {
    $obj | Add-Member -NotePropertyName 'claudeCode.skipApiCheck' -NotePropertyValue $true -Force
  }
  if (-not ($obj.PSObject.Properties.Name -contains 'claudeCode.disableLoginPrompt')) {
    $obj | Add-Member -NotePropertyName 'claudeCode.disableLoginPrompt' -NotePropertyValue $true -Force
  }
  if (-not ($obj.PSObject.Properties.Name -contains 'claudeCode.model')) {
    $obj | Add-Member -NotePropertyName 'claudeCode.model' -NotePropertyValue 'anthropic.openrouter.openrouter-auto' -Force
  }
  ($obj | ConvertTo-Json -Depth 40) | Set-Content -Path $SettingsPath -Encoding UTF8
  Write-Host "set claudeCode.claudeProcessWrapper = $ExePath"
  return $true
}

function Set-IdeWrappers {
  param([string]$ExePath)
  Write-Step "Configuring Claude Code IDE hosts (Cursor / VS Code / ...)"
  $patched = 0
  foreach ($t in Get-IdeSettingsTargets) {
    if (Patch-IdeSettingsFile -Name $t.Name -SettingsPath $t.Path -ExePath $ExePath) {
      $patched++
    }
  }
  if ($patched -eq 0) {
    Write-Warning "No IDE settings were patched. Install Cursor or VS Code + Claude Code extension, then re-run."
    Write-Warning "CLI still works via PATH shims once a provider is configured."
  } else {
    Write-Host "Patched $patched IDE host(s)."
  }
}

function Get-ClaudeHome {
  return (Join-Path $env:USERPROFILE '.claude')
}

function Get-WrapperInstallDir {
  return (Join-Path (Get-ClaudeHome) 'wrapper')
}

function Ensure-ClaudeHome {
  $claude = Get-ClaudeHome
  $wrapper = Get-WrapperInstallDir
  New-Item -ItemType Directory -Path $claude -Force | Out-Null
  New-Item -ItemType Directory -Path $wrapper -Force | Out-Null

  $legacy = Join-Path $env:USERPROFILE '.claude-native'
  $providers = Join-Path $claude 'providers.json'
  $envFile = Join-Path $claude '.env'

  # Migrate legacy ~/.claude-native config into ~/.claude
  if (Test-Path $legacy) {
    $legacyProviders = Join-Path $legacy 'providers.json'
    $legacyEnv = Join-Path $legacy '.env'
    $legacyToken = Join-Path $legacy 'bridge.token'
    if ((Test-Path $legacyProviders) -and -not (Test-Path $providers)) {
      Copy-Item $legacyProviders $providers -Force
      Write-Host "migrated providers.json -> $providers"
    }
    if ((Test-Path $legacyEnv) -and -not (Test-Path $envFile)) {
      Copy-Item $legacyEnv $envFile -Force
      Write-Host "migrated .env -> $envFile"
    }
    if (Test-Path $legacyToken) {
      $tokenDest = Join-Path $wrapper 'bridge.token'
      if (-not (Test-Path $tokenDest)) {
        Copy-Item $legacyToken $tokenDest -Force
        Write-Host "migrated bridge.token -> $tokenDest"
      }
    }
  }

  if (Test-Path $providers) {
    Write-Host "providers.json already exists ($providers)"
  } else {
    Write-Host "no provider yet - the first Claude launch opens a local page for the provider, model, and API key"
  }
}

function Deploy-WrapperInstall {
  $dest = Get-WrapperInstallDir
  New-Item -ItemType Directory -Path $dest -Force | Out-Null

  $excludeDirs = @('node_modules', '.git', 'skills')
  Get-ChildItem -Path $here -Force | ForEach-Object {
    $name = $_.Name
    if ($excludeDirs -contains $name) { return }
    if ($name -like '*.bun-build') { return }
    if ($name -eq '.env') { return }
    if ($name -match '^claudio-wrapper-native.*\.exe$') { return }
    $target = Join-Path $dest $name
    if ($_.PSIsContainer) {
      robocopy $_.FullName $target /E /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
    } else {
      Copy-Item -LiteralPath $_.FullName -Destination $target -Force
    }
  }

  Get-ChildItem -Path $dest -Filter 'claudio-wrapper-native*.exe' -File -ErrorAction SilentlyContinue |
    ForEach-Object { Remove-Item $_.FullName -Force }

  $exe = Join-Path $dest 'claude-wrapper.exe'
  if (-not (Test-Path $exe)) {
    throw "claude-wrapper.exe missing after deploy ($dest). From the wrapper dir: bun build --compile ./claude-wrapper.js --outfile ./claude-wrapper.exe"
  }
  Write-Host "deployed wrapper -> $dest"
  return (Get-Item $exe)
}

# --- main ---
Write-Host ""
Write-Host "Claude Code + third-party bridge installer" -ForegroundColor Yellow
Write-Host "Wrapper dir: $here"

Write-Step "Checking official Claude Code"
$null = Ensure-ClaudeCode

Write-Step "Ensuring ~/.claude + migrating legacy ~/.claude-native"
Ensure-ClaudeHome

Write-Step "Deploying wrapper -> ~/.claude/wrapper"
$installed = Deploy-WrapperInstall
Set-IdeWrappers -ExePath $installed.FullName

Write-Step "Installing PATH shims (claude)"
$shim = Join-Path $here 'install-cli-shims.ps1'
if (Test-Path $shim) {
  & powershell -ExecutionPolicy Bypass -File $shim -WrapperDir (Get-WrapperInstallDir)
} else {
  Write-Warning "install-cli-shims.ps1 missing - skip"
}

Write-Host ""
Write-Host "Done." -ForegroundColor Green
Write-Host "  Wrapper: $($installed.FullName)"
Write-Host "  Providers: ~/.claude/providers.json  (active, model, models)"
Write-Host "  Env: ~/.claude/.env (provider API key)"
Write-Host "  Next: reload your IDE window, open Claude Code"
Write-Host ""
