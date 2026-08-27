# Claude Code + provider bridge

Official Claude Code harness. Inference goes to whatever is in
`~/.claude-native/providers.json` (or `./providers.json`) via a local
Anthropic Messages → Chat Completions **or Responses** bridge that starts with Claude and
exits with it — no background Node server. Third party providers picker shows on first run if no `apiKey`.

## Layout

| Path | Role |
| --- | --- |
| `claudio-wrapper.js` | Launches Claude Code + ephemeral bridge; shows Third party providers if no apiKey |
| `claude-cli.js` | CLI entry |
| `native-bridge.js` | Loopback Anthropic-compatible proxy |
| `lib/bridge/messages.js` | Router (50 lines) → chat vs responses |
| `lib/bridge/messages-chat.js` | Chat Completions handler |
| `lib/bridge/messages-responses.js` | Responses handler (muse-spark, reasoning summary) |
| `lib/bridge/translate.js` | Anthropic → Chat Completions |
| `lib/bridge/translate-responses.js` | Anthropic → Responses (`input`/`instructions`) |
| `lib/bridge/stream.js` | Chat SSE reader |
| `lib/bridge/stream-responses.js` | Responses SSE reader (`reasoning_summary_text.delta`) |
| `lib/bridge/delta.js` | Shared `takeDelta` dedup |
| `lib/bridge/` | Prune / vision / count-tokens / proxy |
| `lib/provider/` | Resolve models + sync picker settings |
| `lib/provider/third-party-ui.js` | Third party providers CLI picker (OpenCode Zen / Nvidia / OpenAI Compatible) |
| `providers.json` | Active provider + model + `format`/`modelFormats` |
| `claudio-wrapper-nativeN.exe` | Windows process wrapper for Cursor/VS Code |
| `set-default-model.js` | Change default model + sync settings |
| `install.ps1` / `install-cli-shims.ps1` | Install wrapper + PATH shims |

## Config

```json
{
  "active": "opencode",
  "providers": {
    "opencode": {
      "baseUrl": "https://opencode.ai/zen/v1",
      "model": "muse-spark-1.2-contributor-free",
      "apiKeyEnv": "OPENCODE_API_KEY",
      "tools": true,
      "format": "chat",
      "modelFormats": { "muse-spark-1.2-contributor-free": "responses" },
      "models": [
        "muse-spark-1.2-contributor-free",
        "laguna-s-2.1-free",
        "hy3-free"
      ]
    },
    "nvidia": {
      "baseUrl": "https://integrate.api.nvidia.com/v1",
      "model": "nvidia/nemotron-3.5-lightning-30b-a3b",
      "apiKeyEnv": "NVIDIA_API_KEY",
      "tools": true,
      "format": "chat",
      "models": [
        "nvidia/nemotron-3-nano-30b-a3b",
        "nvidia/nemotron-3.5-lightning-30b-a3b"
      ]
    }
  }
}
```

`format: "chat"` (default) uses `/chat/completions`; `modelFormats: { "muse-spark": "responses" }` routes that model to `/responses` with `reasoning: {effort:"low", summary:"auto"}` so Thoughts show.

Cursor/VS Code:

```json
"claudeCode.claudeProcessWrapper": "C:\\Users\\<you>\\claudio\\claude-wrapper\\claudio-wrapper-nativeN.exe",
"claudeCode.disableLoginPrompt": true,
"claudeCode.skipApiCheck": true
```

Change model: `node set-default-model.js nvidia/nemotron-3-ultra-550b-a55b`
