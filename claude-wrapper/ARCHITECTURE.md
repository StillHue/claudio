# Claude Code + third-party model

**O que é:** Claude Code **oficial** (UI, tools, permissions) + inferência em um modelo third-party.

```
Claude Code  →  bridge local (Anthropic Messages → Chat Completions)  →  mistral-code-latest
```

Não é fork Ink, não é OpenRouter Auto, não é cascade de modelos.

## Config

`~/.claude/providers.json` + `~/.claude/.env`

```json
{
  "active": "mistral",
  "providers": {
    "mistral": {
      "baseUrl": "https://api.mistral.ai/v1",
      "model": "mistral-code-latest",
      "apiKeyEnv": "MISTRAL_API_KEY",
      "format": "chat",
      "tools": true,
      "models": ["mistral-code-latest"]
    }
  }
}
```

```env
MISTRAL_API_KEY=...
```

No picker do Claude Code use **Sonnet 5** (cosmético; id `anthropic.mistral.mistral-code-latest` → `mistral-code-latest`). Ids legados (`openrouter-auto`, bare Auto) ainda resolvem.

## Install

Windows:

```powershell
cd claude-wrapper
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

Linux/macOS:

```bash
cd claude-wrapper
bash ./install.sh
```

IDE: `claudeCode.claudeProcessWrapper` → `~/.claude/wrapper/claudio-wrapper.cmd` (Windows) ou `~/.claude/wrapper/claudio-wrapper.sh` (Linux/macOS).
Depois: **Reload Window**.

> Binary resolution order (all platforms): `CLAUDE_CODE_BINARY` override → `~/.local/bin/claude` → npm global (`@anthropic-ai/claude-code`) → extension bundles (incl. `*-server` remote-SSH roots on Linux). Newest semver wins — stale copies never shadow the current CLI.

## Layout

| Path | Papel |
| --- | --- |
| `claudio-wrapper.js` | Sobe o bridge e spawna o Claude oficial |
| `native-bridge.js` | HTTP local Anthropic-shaped |
| `lib/bridge/*` | Translate + chat upstream |
| `providers.json` | Um provider, um model |
