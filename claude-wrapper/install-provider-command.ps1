#Requires -Version 5.1
<#
.SYNOPSIS
  Install /provider skill (delegates to Node so files are UTF-8 without BOM).
#>
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
node (Join-Path $here 'install-provider-command.js')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
