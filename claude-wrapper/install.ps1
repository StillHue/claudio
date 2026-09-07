#Requires -Version 5.1
<#
.SYNOPSIS
  One-click setup: official Claude Code + Claudio native wrapper + IDE hosts + provider UI.

.DESCRIPTION
  From a clone of StillHue/claudio (or any checkout with claude-wrapper/):

    powershell -ExecutionPolicy Bypass -File .\claude-wrapper\install.ps1

  What it does:
    1. Ensures official Claude Code (install.ps1 if missing)
    2. Builds claudio-wrapper-nativeN.exe with Bun (or reuses latest if -SkipBuild)
    3. Points Claude Code IDE hosts (Cursor, VS Code, Insiders, VSCodium) at that .exe
    4. Creates ~/.claude-native/ + PATH shims (claude/claudio)
    5. First Claude launch opens the provider picker (no wrong provider seeded)
.PARAMETER SkipClaudeInstall
  Do not run Anthropic's install.ps1 even if claude.exe is missing.

.PARAMETER SkipBuild
  Do not compile; use the highest existing claudio-wrapper-native*.exe.

.PARAMETER SkipProviderUi
  Do not open provider-ui.js at the end.

.PARAMETER WrapperNumber
  Force outfile claudio-wrapper-native{N}.exe (default: max existing + 1, or 20).
#>
[CmdletBinding()]
param(
  [switch]$SkipClaudeInstall,
  [switch]$SkipBuild,
  [switch]$SkipProviderUi,
  [int]$WrapperNumber = 0
)

$ErrorActionPreference = 'Stop'
$here = (Resolve-Path (Split-Path -Parent $MyInvocation.MyCommand.Path)).Path
Set-Location $here

function Write-Step([string]$msg) {
  Write-Host ""
  Write-Host "==> $msg" -ForegroundColor Cyan
}

function Get-LatestNativeExe {
  $files = Get-ChildItem -Path $here -Filter 'claudio-wrapper-native*.exe' -File -ErrorAction SilentlyContinue
  if (-not $files) { return $null }
  $ranked = foreach ($f in $files) {
    $n = 0
    if ($f.BaseName -match 'native(\d+)$') { $n = [int]$Matches[1] }
    elseif ($f.BaseName -eq 'claudio-wrapper-native') { $n = 0 }
    [pscustomobject]@{ File = $f; N = $n }
  }
  return ($ranked | Sort-Object N -Descending | Select-Object -First 1).File
}

function Get-NextNativeNumber {
  $latest = Get-LatestNativeExe
  if (-not $latest) { return 20 }
  if ($latest.BaseName -match 'native(\d+)$') { return ([int]$Matches[1] + 1) }
  return 20
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

function Ensure-Bun {
  $bun = Get-Command bun -ErrorAction SilentlyContinue
  if ($bun) { return $bun.Source }
  Write-Step "Bun not found - installing..."
  try {
    irm https://bun.sh/install.ps1 | iex
  } catch {
    Write-Warning "Bun install failed: $($_.Exception.Message)"
    return $null
  }
  $bunBin = Join-Path $env:USERPROFILE '.bun\bin'
  $env:Path = "$bunBin;$env:Path"
  $bun = Get-Command bun -ErrorAction SilentlyContinue
  if ($bun) { return $bun.Source }
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

function Build-Wrapper {
  param([int]$N)
  $outfile = Join-Path $here "claudio-wrapper-native$N.exe"
  Write-Step "Building $outfile"
  $bun = Ensure-Bun
  if (-not $bun) {
    throw "Bun is required to build the wrapper. Install from https://bun.sh then re-run."
  }
  & bun build --compile .\claudio-wrapper.js --outfile $outfile
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path $outfile)) {
    throw "bun build failed (exit $LASTEXITCODE)"
  }
  return (Get-Item $outfile)
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
  Write-Step "Configuring Claude Code IDE hosts (Cursor / VS Code / …)"
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

function Ensure-NativeHome {
  $dir = Join-Path $env:USERPROFILE '.claude-native'
  New-Item -ItemType Directory -Path $dir -Force | Out-Null
  $providers = Join-Path $dir 'providers.json'
  # Do NOT seed a provider here — wrong default (e.g. OpenCode) causes API errors
  # when the user only has another key (NVIDIA / OpenAI). First Claude launch
  # shows the Third party providers picker and writes providers.json + .env.
  if (Test-Path $providers) {
    Write-Host "providers.json already exists ($providers)"
  } else {
    Write-Host "no providers.json yet — first Claude launch will open the provider picker"
  }
}

# --- main ---
Write-Host ""
Write-Host "Claudio native installer" -ForegroundColor Yellow
Write-Host "Wrapper dir: $here"

Write-Step "Checking official Claude Code"
$null = Ensure-ClaudeCode

$exe = $null
if ($SkipBuild) {
  $exe = Get-LatestNativeExe
  if (-not $exe) { throw "No claudio-wrapper-native*.exe found. Re-run without -SkipBuild." }
  Write-Host "Reusing $($exe.FullName)"
} else {
  $n = if ($WrapperNumber -gt 0) { $WrapperNumber } else { Get-NextNativeNumber }
  try {
    $exe = Build-Wrapper -N $n
  } catch {
    Write-Warning $_.Exception.Message
    $exe = Get-LatestNativeExe
    if (-not $exe) { throw }
    Write-Warning "Build failed - falling back to $($exe.FullName)"
  }
}

Set-IdeWrappers -ExePath $exe.FullName

Write-Step "Ensuring ~/.claude-native"
Ensure-NativeHome

Write-Step "Installing PATH shims (claude)"
$shim = Join-Path $here 'install-cli-shims.ps1'
if (Test-Path $shim) {
  & powershell -ExecutionPolicy Bypass -File $shim
} else {
  Write-Warning "install-cli-shims.ps1 missing - skip"
}

Write-Host ""
Write-Host "Done." -ForegroundColor Green
Write-Host "  Wrapper: $($exe.FullName)"
Write-Host "  Providers: ~/.claude-native/providers.json (set on first Claude launch)"
Write-Host "  Works with: Cursor, VS Code, Insiders, VSCodium, and Claude Code CLI"
Write-Host "  Next: reload your IDE window (or restart), open Claude Code, pick a provider"
Write-Host ""
