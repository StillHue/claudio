#Requires -Version 5.1
<#
.SYNOPSIS
  Install /provider skill into ~/.claude/skills/provider for Claude Code.
#>
$ErrorActionPreference = 'Stop'
$wrapperDir = (Resolve-Path (Split-Path -Parent $MyInvocation.MyCommand.Path)).Path
$template = Join-Path $wrapperDir 'skills\provider\SKILL.md'
if (-not (Test-Path $template)) {
  Write-Error "Missing template: $template"
}

$destDir = Join-Path $env:USERPROFILE '.claude\skills\provider'
New-Item -ItemType Directory -Force -Path $destDir | Out-Null

$body = Get-Content $template -Raw
$body = $body.Replace('{{WRAPPER_DIR}}', ($wrapperDir -replace '\\', '/'))
$dest = Join-Path $destDir 'SKILL.md'
Set-Content -Path $dest -Value $body -Encoding UTF8

# Legacy commands path (still works in Claude Code)
$cmdDir = Join-Path $env:USERPROFILE '.claude\commands'
New-Item -ItemType Directory -Force -Path $cmdDir | Out-Null
$cmdBody = @"
---
description: List providers, connect API key, sync models for /model
disable-model-invocation: true
allowed-tools: Bash, Read
argument-hint: "[provider-id]"
---

Follow the /provider skill at ~/.claude/skills/provider/SKILL.md exactly.
Wrapper: $($wrapperDir -replace '\\', '/')
Arguments: `$ARGUMENTS
"@
Set-Content -Path (Join-Path $cmdDir 'provider.md') -Value $cmdBody -Encoding UTF8

Write-Host "Installed:"
Write-Host "  $dest"
Write-Host "  $(Join-Path $cmdDir 'provider.md')"
Write-Host ""
Write-Host "Restart Claude Code (or Reload Window), then type: /provider"
Write-Host "Terminal wizard: node `"$wrapperDir\enable-provider.js`""
