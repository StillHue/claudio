#Requires -Version 5.1
<#
.SYNOPSIS
  Point PATH `claude` / `claudio` at the official Claude Code harness wrapper.
#>
$ErrorActionPreference = 'Stop'
$here = (Resolve-Path (Split-Path -Parent $MyInvocation.MyCommand.Path)).Path
$npm = Join-Path $env:APPDATA 'npm'
if (-not (Test-Path $npm)) {
  Write-Error "npm global bin not found: $npm"
}

$cmdContent = @"
@ECHO off
SETLOCAL
IF NOT DEFINED CLAUDE_WRAPPER_MODE SET "CLAUDE_WRAPPER_MODE=native"
SET "HERE=$here"
IF EXIST "%HERE%\claudio-wrapper-native19.exe" (
  "%HERE%\claudio-wrapper-native19.exe" %*
  EXIT /B %ERRORLEVEL%
)
IF EXIST "%HERE%\claudio-wrapper-native18.exe" (
  "%HERE%\claudio-wrapper-native18.exe" %*
  EXIT /B %ERRORLEVEL%
)
node "%HERE%\claude-cli.js" %*
EXIT /B %ERRORLEVEL%
"@

foreach ($name in @('claude.cmd', 'claudio.cmd')) {
  $target = Join-Path $npm $name
  if (Test-Path $target) {
    Copy-Item $target "$target.bak-claudio-fork" -Force
    Write-Host "backed up $target"
  }
  Set-Content -Path $target -Value $cmdContent -Encoding ASCII
  Write-Host "installed $target"
}

foreach ($name in @('claude.ps1', 'claudio.ps1')) {
  $ps1 = Join-Path $npm $name
  if (Test-Path $ps1) {
    Copy-Item $ps1 "$ps1.bak-claudio-fork" -Force
    Remove-Item $ps1 -Force
    Write-Host "removed $ps1 (was shadowing .cmd)"
  }
}

Write-Host ""
Write-Host "Done. Open a new terminal and run: claude --version"
Write-Host "Expect: Claude Code X.Y.Z (not Claudio 0.26)"
Write-Host "Providers: ~/.claude-native/providers.json with API key enables OpenCode/Cohere bridge."
Write-Host "Legacy Ink fork: set CLAUDE_WRAPPER_MODE=claudio"

# Install /provider slash skill for Claude Code
$installProvider = Join-Path $here 'install-provider-command.ps1'
if (Test-Path $installProvider) {
  & $installProvider
}
