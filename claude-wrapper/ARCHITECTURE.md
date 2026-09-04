# Claude Code + provider bridge

Official Claude Code harness. Inference goes to whatever is in
`~/.claude-native/providers.json` (or `./providers.json`) via a local
Anthropic Messages -> Chat Completions **or Responses** bridge that starts with Claude and
exits with it -- no background Node server. Third party providers picker shows on first run if no `apiKey`.


## Auto model

`Auto` / `anthropic.auto` always routes to OpenRouter (`openrouter/auto`).
Classification, sticky multi-turn, vision vs coding, and rate-limit fallbacks are handled by OpenRouter Auto Router.
NVIDIA is used via OpenRouter BYOK on the account -- the wrapper does not call NVIDIA or OpenCode directly on the Auto path.
Required: `OPENROUTER_API_KEY`. Optional: `OPENROUTER_COST_TIER`.

## Layout

| Path | Role |
| --- | --- |
| `claudio-wrapper.js` | Launches Claude Code + ephemeral bridge; shows Third party providers if no apiKey |
| `claude-cli.js` | CLI entry |
| `native-bridge.js` | Loopback Anthropic-compatible proxy |
| `lib/bridge/messages.js` | Router (50 lines) -> chat vs responses |
| `lib/bridge/messages-chat.js` | Chat Completions handler |
| `lib/bridge/messages-responses.js` | Responses handler (muse-spark, reasoning summary) |
| `lib/bridge/translate.js` | Anthropic -> Chat Completions |
| `lib/bridge/translate-responses.js` | Anthropic -> Responses (`input`/`instructions`) |
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
  "active": "openrouter",
  "providers": {
    "openrouter": {
      "baseUrl": "https://openrouter.ai/api/v1",
      "model": "openrouter/auto",
      "apiKeyEnv": "OPENROUTER_API_KEY",
      "tools": true,
      "format": "chat",
      "models": [
        "openrouter/auto",
        "openrouter/auto-beta"
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

Change model: `node set-default-model.js openrouter/auto`
