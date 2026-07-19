Set-StrictMode -Version Latest

function Test-ClaudioCommand {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name
  )

  return [bool](Get-Command -Name $Name -ErrorAction SilentlyContinue)
}

function Assert-ClaudioCommand {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name,
    [Parameter(Mandatory = $true)]
    [string]$InstallHint
  )

  if (-not (Test-ClaudioCommand -Name $Name)) {
    throw "Required command '$Name' was not found. $InstallHint"
  }
}

function Invoke-Claudio {
  [CmdletBinding()]
  param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$ClaudioArgs
  )

  Assert-ClaudioCommand -Name "openclaude" -InstallHint "Install with: npm install -g @gitlawb/openclaude"

  & openclaude @ClaudioArgs

  if ($LASTEXITCODE -ne 0) {
    throw "openclaude failed with exit code $LASTEXITCODE."
  }
}

function Invoke-ClaudioWithEnvironment {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [hashtable]$Environment,
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$ClaudioArgs
  )

  $previousValues = @{}

  foreach ($name in $Environment.Keys) {
    $previousValues[$name] = [Environment]::GetEnvironmentVariable($name, "Process")
    Set-Item -Path "Env:$name" -Value $Environment[$name]
  }

  try {
    Invoke-Claudio @ClaudioArgs
  }
  finally {
    foreach ($name in $Environment.Keys) {
      if ($null -eq $previousValues[$name]) {
        Remove-Item -Path "Env:$name" -ErrorAction SilentlyContinue
      }
      else {
        Set-Item -Path "Env:$name" -Value $previousValues[$name]
      }
    }
  }
}

function Get-ClaudioQuickHelp {
  [CmdletBinding()]
  param()

  @(
    "Claudio quick commands:",
    "  oc [args...]              -> launch Claudio using the installed CLI",
    "  oc-local [args...]        -> launch Claudio with local/Ollama OpenAI-compatible environment hints for this invocation only",
    "  oc-fast [args...]         -> launch Claudio with low-latency local defaults for this invocation only",
    "  oc-provider               -> open the provider manager in Claudio",
    "  oc-check                  -> show Ollama install/listening/model state",
    "  oc-init                   -> pull/check the local model, then launch local/Ollama mode",
    "  oc-help                   -> show this help"
  ) -join [Environment]::NewLine
}

function oc {
  [CmdletBinding()]
  param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$ClaudioArgs
  )

  Invoke-Claudio @ClaudioArgs
}

function oc-local {
  [CmdletBinding()]
  param(
    [string]$Model = "llama3.1:8b",
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$ClaudioArgs
  )

  Invoke-ClaudioWithEnvironment `
    -Environment @{
      CLAUDE_CODE_USE_OPENAI = "1"
      OPENAI_BASE_URL        = "http://localhost:11434/v1"
      OPENAI_MODEL           = $Model
    } `
    @ClaudioArgs
}

function oc-fast {
  [CmdletBinding()]
  param(
    [string]$Model = "llama3.1:8b",
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$ClaudioArgs
  )

  Invoke-ClaudioWithEnvironment `
    -Environment @{
      CLAUDE_CODE_USE_OPENAI = "1"
      OPENAI_BASE_URL        = "http://localhost:11434/v1"
      OPENAI_MODEL           = $Model
      OPENCLAUDE_FAST_MODE   = "1"
    } `
    @ClaudioArgs
}

function oc-provider {
  [CmdletBinding()]
  param()

  Invoke-Claudio "/provider"
}

function oc-check {
  [CmdletBinding()]
  param(
    [string]$Model = "llama3.1:8b"
  )

  Assert-ClaudioCommand -Name "ollama" -InstallHint "Install Ollama from https://ollama.com/download/windows."

  $version = & ollama --version 2>$null
  $modelNames = (& ollama list 2>$null | Select-Object -Skip 1 | ForEach-Object {
      ($_ -split "\s+")[0]
    }) | Where-Object { $_ }

  $isModelAvailable = $modelNames -contains $Model
  $probeSucceeded = $false

  try {
    $response = Invoke-RestMethod -Uri "http://localhost:11434/api/tags" -Method Get -TimeoutSec 3
    if ($response.models) {
      $probeSucceeded = $true
    }
  }
  catch {
    $probeSucceeded = $false
  }

  [PSCustomObject]@{
    OllamaInstalled = $true
    OllamaVersion   = $version
    OllamaListening = $probeSucceeded
    Model           = $Model
    ModelAvailable  = $isModelAvailable
  }
}

function oc-init {
  [CmdletBinding()]
  param(
    [string]$Model = "llama3.1:8b",
    [switch]$SkipModelPull
  )

  Assert-ClaudioCommand -Name "ollama" -InstallHint "Install Ollama from https://ollama.com/download/windows."

  if (-not $SkipModelPull) {
    & ollama pull $Model
    if ($LASTEXITCODE -ne 0) {
      throw "ollama pull $Model failed with exit code $LASTEXITCODE."
    }
  }

  $health = oc-check -Model $Model
  if (-not $health.OllamaListening) {
    Write-Warning "Ollama is installed but API probe to localhost:11434 did not succeed. Start Ollama and retry."
  }

  oc-local -Model $Model
}

function oc-help {
  [CmdletBinding()]
  param()

  Get-ClaudioQuickHelp
}
