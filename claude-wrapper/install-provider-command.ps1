#Requires -Version 5.1
# Provider setup = terminal wizard only (no Claude chat skill / no keys in transcript).
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
node (Join-Path $here 'uninstall-provider-skill.js')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
node (Join-Path $here 'install-provider-command.js')
