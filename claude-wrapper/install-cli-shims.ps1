#Requires -Version 5.1
<#
.SYNOPSIS
  Point PATH claude / claudio at the official Claude Code harness wrapper.

.PARAMETER WrapperDir
  Install directory (default: ~/.claude/wrapper, then the script folder).
#>
param(
  [string]$WrapperDir = ''
)

$ErrorActionPreference = 'Stop'
$scriptDir = (Resolve-Path (Split-Path -Parent $MyInvocation.MyCommand.Path)).Path
$defaultInstall = Join-Path $env:USERPROFILE '.claude\wrapper'
if ($WrapperDir -and (Test-Path $WrapperDir)) {
  $here = (Resolve-Path $WrapperDir).Path
} elseif (Test-Path $defaultInstall) {
  $here = (Resolve-Path $defaultInstall).Path
} else {
  $here = $scriptDir
}

$npm = Join-Path $env:APPDATA 'npm'
if (-not (Test-Path $npm)) {
  Write-Error "npm global bin not found: $npm - install Node.js first"
}

$cmdText = @"
@ECHO off
SETLOCAL
SET "HERE=$here"
node "%HERE%\claude-cli.js" %*
EXIT /B %ERRORLEVEL%
"@

foreach ($name in @('claude.cmd', 'claudio.cmd')) {
  $target = Join-Path $npm $name
  if (Test-Path $target) {
    Copy-Item $target "$target.bak-claude-bridge" -Force
    Write-Host "backed up $target"
  }
  Set-Content -Path $target -Value $cmdText -Encoding ASCII
  Write-Host "installed $target"
}

foreach ($name in @('claude.ps1', 'claudio.ps1')) {
  $ps1 = Join-Path $npm $name
  if (Test-Path $ps1) {
    Copy-Item $ps1 "$ps1.bak-claude-bridge" -Force
    Remove-Item $ps1 -Force
    Write-Host "removed $ps1 (was shadowing .cmd)"
  }
}

Write-Host ""
Write-Host "Done. Open a new terminal and run: claude --version"
Write-Host "Expect: Claude Code X.Y.Z"
Write-Host "Providers: ~/.claude/providers.json + provider API key in ~/.claude/.env"
Write-Host "First-run key setup: node .\lib\provider\third-party-ui.js"

# Official Claude native installer drops claude.exe in ~/.local/bin, which
# shadows npm shims (PATHEXT prefers .exe over .cmd) and bypasses the wrapper.
$localBin = Join-Path $env:USERPROFILE '.local\bin'
if (Test-Path $localBin) {
  $localExe = Join-Path $localBin 'claude.exe'
  if (Test-Path $localExe) {
    $official = Join-Path $localBin 'claude-official.exe'
    if (-not (Test-Path $official)) {
      Move-Item $localExe $official -Force
      Write-Host "renamed $localExe -> claude-official.exe (wrapper owns claude)"
    } elseif ((Get-Item $localExe).FullName -ne (Get-Item $official).FullName) {
      Remove-Item $localExe -Force
      Write-Host "removed shadowing $localExe (kept claude-official.exe)"
    }
  }
  foreach ($name in @('claude.cmd', 'claudio.cmd')) {
    $target = Join-Path $localBin $name
    Set-Content -Path $target -Value $cmdText -Encoding ASCII
    Write-Host "installed $target"
  }
  foreach ($name in @('claude.ps1', 'claudio.ps1')) {
    $ps1 = Join-Path $localBin $name
    if (Test-Path $ps1) {
      Copy-Item $ps1 "$ps1.bak-claude-bridge" -Force
      Remove-Item $ps1 -Force
      Write-Host "removed $ps1"
    }
  }
}
