#Requires -Version 5.1
<#
.SYNOPSIS
  Point PATH claude / claudio at the official Claude Code harness wrapper.
#>
$ErrorActionPreference = 'Stop'
$here = (Resolve-Path (Split-Path -Parent $MyInvocation.MyCommand.Path)).Path
$npm = Join-Path $env:APPDATA 'npm'
if (-not (Test-Path $npm)) {
  Write-Error "npm global bin not found: $npm - install Node.js first"
}

# Prefer highest claudio-wrapper-nativeN.exe
$ranked = @()
Get-ChildItem -Path $here -Filter 'claudio-wrapper-native*.exe' -File -ErrorAction SilentlyContinue | ForEach-Object {
  $n = 0
  if ($_.BaseName -match 'native(\d+)$') { $n = [int]$Matches[1] }
  $ranked += [pscustomobject]@{ Name = $_.Name; N = $n }
}
$ranked = $ranked | Sort-Object N -Descending
$primary = if ($ranked.Count) { $ranked[0].Name } else { '' }
$secondary = if ($ranked.Count -gt 1) { $ranked[1].Name } else { '' }

$primaryLine = ''
if ($primary) {
  $primaryLine = @(
    "IF EXIST `"%HERE%\$primary`" ("
    "  `"%HERE%\$primary`" %*"
    "  EXIT /B %ERRORLEVEL%"
    ")"
  ) -join "`r`n"
}

$secondaryLine = ''
if ($secondary) {
  $secondaryLine = @(
    "IF EXIST `"%HERE%\$secondary`" ("
    "  `"%HERE%\$secondary`" %*"
    "  EXIT /B %ERRORLEVEL%"
    ")"
  ) -join "`r`n"
}

$cmdContent = @(
  '@ECHO off'
  'SETLOCAL'
  'IF NOT DEFINED CLAUDE_WRAPPER_MODE SET "CLAUDE_WRAPPER_MODE=native"'
  "SET `"HERE=$here`""
  $primaryLine
  $secondaryLine
  'node "%HERE%\claude-cli.js" %*'
  'EXIT /B %ERRORLEVEL%'
) | Where-Object { $_ -ne '' } | ForEach-Object { $_ }

$cmdText = ($cmdContent -join "`r`n") + "`r`n"

foreach ($name in @('claude.cmd', 'claudio.cmd')) {
  $target = Join-Path $npm $name
  if (Test-Path $target) {
    Copy-Item $target "$target.bak-claudio-fork" -Force
    Write-Host "backed up $target"
  }
  Set-Content -Path $target -Value $cmdText -Encoding ASCII
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
if ($primary) { Write-Host "Wrapper exe: $primary" }
Write-Host "Providers: ~/.claude-native/providers.json with API key enables the bridge."
Write-Host "Provider UI: /provider in Claude (or node .\provider-ui.js)"
Write-Host "Legacy Ink fork: set CLAUDE_WRAPPER_MODE=claudio"

$installProvider = Join-Path $here 'install-provider-command.js'
if ((Test-Path $installProvider) -and (Get-Command node -ErrorAction SilentlyContinue)) {
  node $installProvider
}
