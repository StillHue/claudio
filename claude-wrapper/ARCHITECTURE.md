# Claude Code + provider bridge

Official Claude Code harness. Inference goes to whatever is in
`~/.claude-native/providers.json` (or `./providers.json`) via a local
Anthropic Messages → Chat Completions **or Responses** bridge that starts with
Claude and exits with it — no background Node server.

First run with no provider / API key shows the **Third party providers** picker
(OpenCode Zen · Nvidia · OpenAI Compatible).

## Auto model

`Auto` / `anthropic.auto` (canonical picker id `anthropic.openrouter.openrouter-auto`)
is a **local intelligent router over the active provider’s `models[]` catalog** —
same idea as Cursor Auto, not hard-wired to one vendor.

- Classifies the turn: vision · hard (analysis/architecture) · coding · chitchat
- Picks the best matching model **from that provider’s list** (name heuristics)
- On 429/5xx/410/empty stream: retries same model once, then upgrades within the same catalog
- If the active provider is OpenRouter and the only/default model is `openrouter/auto`, Auto passes through to OpenRouter’s Auto Router instead

Your choice of Nvidia vs OpenCode vs custom only changes the catalog Auto can use.

## Layout

| Path | Role |
| --- | --- |
| `claudio-wrapper.js` | Launches Claude Code + ephemeral bridge; Third party providers if no apiKey |
| `native-bridge.js` | Loopback Anthropic-compatible proxy |
| `lib/bridge/auto-router.js` | Provider-agnostic Auto routing |
| `lib/bridge/messages-chat.js` | Chat Completions + empty-stream retry |
| `lib/provider/` | Resolve models + sync picker settings |
| `lib/provider/third-party-ui.js` | First-run provider picker |
| `providers.json` | Active provider + `models[]` used by Auto |
| `claudio-wrapper-nativeN.exe` | Windows process wrapper for Cursor/VS Code |
| `install.ps1` | Install wrapper + Cursor wiring (does **not** seed a wrong provider) |

## Config example (Nvidia)

```json
{
  "active": "nvidia",
  "providers": {
    "nvidia": {
      "baseUrl": "https://integrate.api.nvidia.com/v1",
      "model": "nvidia/nemotron-3-super-120b-a12b",
      "apiKeyEnv": "NVIDIA_API_KEY",
      "tools": true,
      "format": "chat",
      "visionModel": "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
      "models": [
        "nvidia/nemotron-3-ultra-550b-a55b",
        "nvidia/nemotron-3-super-120b-a12b",
        "nvidia/nemotron-3.5-lightning-30b-a3b",
        "nvidia/nemotron-3-nano-30b-a3b",
        "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning"
      ]
    }
  }
}
```

Put the matching API key in `claude-wrapper/.env` or `~/.claude-native/.env`.

Cursor / VS Code (official Claude Code extension):

```json
"claudeCode.claudeProcessWrapper": "C:\\Users\\<you>\\claudio\\claude-wrapper\\claudio-wrapper-nativeN.exe",
"claudeCode.disableLoginPrompt": true,
"claudeCode.skipApiCheck": true
```

## Two install paths (do not mix)

1. **Official Claude Code UI** (recommended): `claude-wrapper/install.ps1` + Cursor/VS Code extension.
2. **Ink CLI fork** (`npm i -g @gaburieuru/claudio`): separate TUI — not the Anthropic Claude Code UI.
