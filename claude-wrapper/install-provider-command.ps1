#Requires -Version 5.1
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
node (Join-Path $here 'install-provider-command.js')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
