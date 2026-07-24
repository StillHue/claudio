# How to Configure the Claude Native Wrapper for Cursor

This guide is the **detailed reference** for humans and agents.

## One-click (Windows)

From the repo root (or `claude-wrapper/`):

```powershell
cd claude-wrapper
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

That script:

1. Ensures official Claude Code (runs Anthropic `install.ps1` if needed)
2. Builds `claudio-wrapper-nativeN.exe` with Bun (or reuses latest with `-SkipBuild`)
3. Sets Cursor `claudeCode.claudeProcessWrapper` + `skipApiCheck`
4. Creates `~/.claude-native/providers.json` stub + PATH shims
5. Installs `/provider` and opens the local provider UI

Then: **Developer: Reload Window** → paste key in the UI → `/model`.

Flags: `-SkipBuild`, `-SkipClaudeInstall`, `-SkipProviderUi`, `-WrapperNumber 21`.

---

**Users who just want Cursor to do the work:** open [AGENT-PROMPT.md](./AGENT-PROMPT.md), copy everything below the line, paste into a new Cursor chat, and answer with your API keys when asked.

> **Default mode is `native`.** The harness is always the **official Anthropic Claude Code binary** (latest on disk). Custom providers (OpenCode/Cohere) go through the local bridge. The Ink fork (`CLAUDE_WRAPPER_MODE=claudio`, `@gaburieuru/claudio` 0.26) is **legacy** and is not feature-parity with Claude Code.

## What the Wrapper Does

```
Official Claude Code (install.ps1 → ~/.local/bin/claude.exe, or Cursor extension bundle)
  → always the newest binary found (semver)
Cursor Agents Window / terminal `claude`
  → claudio-wrapper-nativeN.exe
    → syncs default model (providers.json → ~/.claude/settings.json + Cursor)
    → if providers.json has an API key: start Anthropic↔ChatCompletions bridge
    → spawn official claude.exe (+ ANTHROPIC_BASE_URL when bridged)
         ↓
    Claude Code harness (100% official commands / TUI / tools)
         ↓  POST /v1/messages  (bridge or real Anthropic)
```

Picker model ids **must** look like `anthropic.<slug>` (no slashes). Free OpenCode Zen models use Anthropic-equivalent slugs, e.g. `anthropic.claude-sonnet-5` → upstream `deepseek-v4-flash-free`.

## Prerequisites

1. **Official Claude Code** via `irm https://claude.ai/install.ps1 | iex` (recommended; auto-updates) **and/or** the Cursor extension `anthropic.claude-code`
2. **Bun** (to compile the wrapper) and/or a prebuilt `claudio-wrapper-native*.exe`
3. For OpenCode/Cohere: API key in `~/.claude-native/providers.json` (without a key, the wrapper is a pure passthrough to official Claude)
4. For images on text-only providers: **Groq** key (vision routing)

Node.js is only needed if you run the `.js` sources directly; the compiled `.exe` embeds the runtime.

## Step 1 — Build the Wrapper

```bash
cd claudio/claude-wrapper
bun build --compile ./claudio-wrapper.js --outfile claudio-wrapper-native19.exe
```

Use the **`.exe`**, never `.cmd` (Windows `spawn` without shell → `EINVAL`).

Point Cursor at the **latest** `claudio-wrapper-nativeN.exe` you just built (increment `N` when shipping fixes so old Cursor sessions don’t keep a stale binary locked).

### Terminal CLI = same official harness

```powershell
# Keep Anthropic CLI updated
irm https://claude.ai/install.ps1 | iex

# Point PATH `claude` / `claudio` at this wrapper (backs up old npm shims)
cd claudio/claude-wrapper
powershell -ExecutionPolicy Bypass -File .\install-cli-shims.ps1

claude --version
# Expect: Claude Code X.Y.Z  (not "Claudio 0.26")
```

Override binary: `CLAUDE_CODE_BINARY=C:\path\to\claude.exe`  
Legacy Ink fork: `CLAUDE_WRAPPER_MODE=claudio`

## Step 2 — Cursor Settings

Open Cursor Settings JSON (`Ctrl+Shift+P` → “Preferences: Open User Settings (JSON)”) and set:

| Setting | Value |
|---------|--------|
| `claudeCode.claudeProcessWrapper` | Absolute path to `claudio-wrapper-nativeN.exe` |
| `claudeCode.skipApiCheck` | `true` (recommended) |
| `claudeCode.model` | e.g. `anthropic.deepseek-v4-flash-free` |
| `CLAUDE_WRAPPER_MODE` (env, optional) | `native` (default when extension passes bundled `claude.exe`) |
| `CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY` | `1` (wrapper sets this if missing) |

Example:

```json
{
  "claudeCode.claudeProcessWrapper": "C:\\Users\\<you>\\claudio\\claude-wrapper\\claudio-wrapper-native19.exe",
  "claudeCode.skipApiCheck": true,
  "claudeCode.model": "anthropic.deepseek-v4-flash-free"
}
```

Then **Developer: Reload Window**.

## Step 3 — Providers Catalog

Create `~/.claude-native/providers.json` (fallback: `~/.codius/providers.json`):

```json
{
  "active": "opencode",
  "providers": {
    "opencode": {
      "baseUrl": "https://opencode.ai/zen/v1",
      "model": "deepseek-v4-flash-free",
      "apiKeyEnv": "OPENAI_API_KEY",
      "apiKey": "<opencode-key-or-omit-if-env-set>",
      "tools": true,
      "models": [
        "deepseek-v4-flash-free",
        "big-pickle",
        "mimo-v2.5-free",
        "north-mini-code-free",
        "laguna-s-2.1-free",
        "nemotron-3-ultra-free"
      ]
    },
    "cohere": {
      "baseUrl": "https://api.cohere.com/compatibility/v1",
      "model": "north-mini-code-1-0",
      "apiKeyEnv": "COHERE_API_KEY",
      "tools": true,
      "models": [
        "north-mini-code-1-0",
        "command-a-03-2025",
        "command-r-plus-08-2024"
      ]
    }
  }
}
```

Notes for the agent:

- Prefer `apiKeyEnv` + OS user env over hardcoding keys. Never commit keys to git.
- On spawn, the wrapper syncs `availableModels` + `enforceAvailableModels` + default `model` into `~/.claude/settings.json`, and aligns Cursor `claudeCode.model`, so the picker lists catalog ids.
- Do **not** set `CLAUDE_CODE_USE_OPENAI` / `OPENAI_BASE_URL` in `~/.claude/settings.json` — that bypasses the Anthropic bridge. The wrapper strips those on sync/spawn.
- Short-lived `auth status` spawns must **not** rewrite settings (already handled in code).

### Provider catalog (models.dev + Zen)

Remote registry for “what can I connect?” (v1 = list/cache; keys still manual):

```bash
cd claude-wrapper
node sync-catalog.js sync              # fetch + write ~/.claude-native/catalog.json
                                       # also refreshes providers.opencode.models (live Zen)
node sync-catalog.js list --bridge     # providers the current bridge can talk to
node sync-catalog.js list --models opencode
node sync-catalog.js show groq
```

- Cache: `~/.claude-native/catalog.json` (do not commit secrets — catalog has none).
- To enable another provider: copy `baseUrl` / `apiKeyEnv` / `models` from `show <id>` into `providers.json` and set `apiKey` or the env var. Only `dialect=openai-chat` with a `baseUrl` is bridge-ready (`*` in `list`).

### `/provider` UI (inside Claude flow)

`/provider` opens a **local page** (`http://127.0.0.1:…`): pick provider → paste API key → save.  
The key never enters the Claude chat transcript.

```powershell
cd claude-wrapper
node install-provider-command.js   # installs ~/.claude/skills/provider
# Restart Claude Code → /provider

# Or open the UI directly:
node provider-ui.js
```

Writes `~/.claude-native/providers.json` and syncs the `/model` picker.

### Change the default model (CLI ↔ extension)

Source of truth: `~/.claude-native/providers.json` → `providers.<active>.model`.

```bash
cd claude-wrapper
node set-default-model.js --list
node set-default-model.js deepseek-v4-flash-free
# or Windows:
set-default-model.cmd north-mini-code-1-0
```

This updates `providers.json`, `~/.claude/settings.json` (`model`), and Cursor `claudeCode.model` (só-se-mudou). Reload the Claude Code window if the picker still shows the previous default.

Changing the model in the Claude Code / Agents Window picker also remembers it: the bridge writes only `providers.json` mid-turn (never rewrites `~/.claude/settings.json` during a stream). Full Claude/Cursor sync happens on the next wrapper spawn or CLI call.

### Picker ids

| Catalog model | Claude Code picker id |
|---------------|------------------------|
| `deepseek-v4-flash-free` | `anthropic.claude-sonnet-5` |
| `mimo-v2.5-free` | `anthropic.claude-haiku-4-5` |
| `big-pickle` | `anthropic.claude-sonnet-4` |
| `north-mini-code-free` | `anthropic.claude-sonnet-4-5` |
| `laguna-s-2.1-free` | `anthropic.claude-sonnet-4-6` |
| `nemotron-3-ultra-free` | `anthropic.claude-opus-4-6` |
| `north-mini-code-1-0` (Cohere) | `anthropic.north-mini-code-1-0` |
| `command-a-03-2025` | `anthropic.command-a-03-2025` |

## Step 4 — Vision Routing (images)

OpenCode / Cohere are text-only. The bridge describes images via Groq **before** calling the main model.

Create `~/.claude-native/.env` (also loads `~/.openclaude/.env` or `~/maniac-agent/.env` if present):

```bash
GROQ_API_KEY=gsk_...
CLAUDE_CODE_VISION_API_KEY=gsk_...
CLAUDE_CODE_VISION_BASE_URL=https://api.groq.com/openai/v1
CLAUDE_CODE_VISION_MODEL=qwen/qwen3.6-27b
CLAUDE_CODE_VISION_ROUTE=1
```

- Disable: `CLAUDE_CODE_DISABLE_VISION_ROUTE=1` or `CLAUDE_CODE_VISION_ROUTE=0`
- Without a Groq key, attaching an image returns a clear 400 from the bridge (do not forward raw `image_url` to text-only providers).

## Step 5 — Verify

1. Reload Window
2. Open **Claude Code** panel (not Codex)
3. Confirm model picker lists `anthropic.*` ids from the catalog
4. Send a short text prompt → expect a reply
5. Optional: attach an image → expect a short delay (Groq describe) then a reply about the image
6. Debug log: `~/claude-native-debug.log` — look for `POST /v1/messages` and `vision route: described N image(s)`

Enable verbose wrapper stderr:

```bash
# User env or session
CLAUDE_WRAPPER_DEBUG=1
```

### Smoke (optional, agent)

```bash
# Text-only path through the bridge (requires providers.json + keys)
cd claudio/claude-wrapper
# Run a small node script that startNativeBridge + POST /v1/messages
# Expect HTTP 200 and non-empty text content
```

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Panel still hits Anthropic / asks for Claude login | Wrapper path wrong, or Reload not done; confirm `claudeProcessWrapper` → `.exe` |
| Empty replies / hung chat | Reasoning models need high `max_tokens` (bridge floors at 8192). Check log for upstream errors |
| `invalid bridge token` / 401 + “Both ANTHROPIC_AUTH_TOKEN and /login…” | Quarantine login + only inject `ANTHROPIC_API_KEY` (not AUTH_TOKEN). Bridge accepts matching x-api-key even if Bearer is OAuth. Last resort: `CLAUDE_NATIVE_BRIDGE_OPEN_LOCAL=1`. Kill stale wrappers and relaunch. |
| Settings rewrite mid-chat / reload loop | Don’t manually thrash `~/.claude/settings.json`; wrapper only writes when content changes |
| Picker shows Opus “Default (recommended)” | `enforceAvailableModels: true` + catalog ids; subtitle may still say Opus but Default resolves to first available |
| Images → upstream 400 | Set Groq vision env (Step 4); confirm log shows `vision route` |
| Vision HTTP 429 | Groq rate limit — retry; bridge retries 429/503 a few times |
| Cohere / OpenCode 401 | Fix `apiKey` / `apiKeyEnv` in `providers.json` |
| Duplicate assistant lines | OpenCode may echo reasoning into content; newer bridge maps reasoning → Anthropic `thinking` and dedupes when possible — rebuild latest exe |
| Thoughts / thinking not shown | Need build that maps OpenAI `reasoning` → Anthropic `thinking` / `thinking_delta` |

## Architecture Notes (for agents)

- **Harness stays official** — only inference is redirected.
- Bridge speaks Anthropic `/v1/messages` (+ SSE) to Claude Code and OpenAI `/v1/chat/completions` upstream.
- Tool use is translated both ways (`tool_use` ↔ `tool_calls`).
- Reasoning → `thinking` blocks for Claude Code Thoughts UI.
- Binding is `127.0.0.1` only. Bridge requires shared token (`~/.claude-native/bridge.token`) via `x-api-key` or Bearer (either may match). Escape hatch: `CLAUDE_NATIVE_BRIDGE_OPEN_LOCAL=1`. Injected `ANTHROPIC_API_KEY` is the bridge token; upstream uses `providers.json` keys.
- Browser `Origin` / CORS preflight are rejected. Vision accepts **base64** image sources only (no URL fetch / SSRF).
- Debug file `~/claude-native-debug.log` only when `CLAUDE_WRAPPER_DEBUG=1`.

## Legacy Mode (`claudio`)

Only if the user explicitly wants the old Claudio CLI instead of official Claude Code:

```bash
CLAUDE_WRAPPER_MODE=claudio
```

Then the wrapper spawns Claudio (`@gaburieuru/claudio`) instead of `claude.exe`. Provider config then lives under `~/.openclaude/` as in older docs. Prefer `native` for Cursor’s Claude Code panel.

## Files Reference

| Path | Purpose |
|------|---------|
| `claude-wrapper/claudio-wrapper.js` | Process wrapper (native + legacy) |
| `claude-wrapper/native-bridge.js` | Anthropic ↔ Chat Completions (+ tools/stream) |
| `claude-wrapper/provider-config.js` | Catalog, picker ids, settings sync |
| `claude-wrapper/provider-catalog.js` | models.dev + Zen → `~/.claude-native/catalog.json` |
| `claude-wrapper/sync-catalog.js` | CLI: sync / list / show providers |
| `claude-wrapper/resolve-official-claude.js` | Pick newest official `claude.exe` (semver) |
| `claude-wrapper/claude-cli.js` / `claude.cmd` | Terminal entry → official harness |
| `claude-wrapper/install-cli-shims.ps1` | Point npm PATH `claude` at wrapper |
| `claude-wrapper/set-default-model.js` | CLI to set default model + sync Claude/Cursor |
| `claude-wrapper/vision-route.js` | Groq image → text before upstream |
| `claudio-wrapper-nativeN.exe` | Bun-compiled binary for Cursor |
| `~/.claude-native/providers.json` | Providers + models catalog |
| `~/.claude-native/catalog.json` | Cached remote registry (models.dev + Zen) |
| `~/.claude-native/.env` | Groq / vision env (preferred) |
| `~/.claude/settings.json` | Synced `availableModels` / default model |
| `~/claude-native-debug.log` | Wrapper/bridge debug log |

## Agent Checklist (copy this)

1. [ ] Build/point `claudeProcessWrapper` at latest `claudio-wrapper-nativeN.exe`
2. [ ] Write `~/.claude-native/providers.json` with user’s keys (env preferred)
3. [ ] Set `claudeCode.model` to an `anthropic.<id>` from the catalog
4. [ ] If user pastes images: write `~/.claude-native/.env` with Groq + `qwen/qwen3.6-27b`
5. [ ] Ensure `~/.claude/settings.json` does **not** force `CLAUDE_CODE_USE_OPENAI`
6. [ ] Reload Window → smoke text → smoke image
7. [ ] Confirm `~/claude-native-debug.log` shows `/v1/messages` (and vision when images)
8. [ ] Never commit API keys; warn user if they pasted keys in chat
