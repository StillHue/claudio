# Agent prompt — configure Claude Code native wrapper

**For the human:** open Cursor (or another AI with filesystem access), paste **everything below the line** into a new chat, and provide your API keys when asked. You don’t need to understand the rest.

**For the agent:** follow every step. Do the work yourself — don’t dump commands for the user unless a secret must be typed by them.

---

You are setting up the **Claude native wrapper** for this user on their machine.

## Goal

Configure Cursor’s **official Claude Code** extension so it keeps Anthropic’s harness (tools, permissions, Thoughts UI) but sends inference to **OpenCode Zen** and/or **Cohere** via a local Anthropic Messages → Chat Completions bridge.

Reference (read if the repo is available): `claude-wrapper/SETUP-GUIDE.md` in the Claudio repo  
(`https://github.com/StillHue/claudio` → folder `claude-wrapper/`).

## Hard rules

1. Prefer mode **`native`** (default). Do **not** use `CLAUDE_WRAPPER_MODE=claudio` unless the user explicitly wants the old Claudio CLI swap.
2. Never commit API keys. Store keys in `~/.claude-native/providers.json` (`apiKey` or `apiKeyEnv`) and/or OS user env / `~/.claude-native/.env`.
3. Picker model ids **must** be `anthropic.<exact-upstream-id>` with **no slashes**  
   (e.g. `anthropic.big-pickle`, `anthropic.north-mini-code-1-0`).
4. Do **not** set `CLAUDE_CODE_USE_OPENAI`, `OPENAI_BASE_URL`, or `OPENAI_MODEL` in `~/.claude/settings.json` — that bypasses the bridge.
5. On Windows, Cursor must point at a **`.exe`**, never `.cmd`.
6. After changing Cursor settings or the wrapper binary: tell the user to **Developer: Reload Window**.
7. If anything fails, fix it and re-verify. Don’t stop at “try this manually” when you can run it.

## Ask the user (only what’s missing)

Ask briefly for whatever you don’t already have:

- Path to the Claudio checkout (or clone `https://github.com/StillHue/claudio`)
- OpenCode Zen API key (optional if only Cohere)
- Cohere API key (optional if only OpenCode)
- Groq API key (optional; required for pasted images on text-only models)
- Preferred default model (suggest `big-pickle` on OpenCode, or `north-mini-code-1-0` / `command-a-03-2025` on Cohere)

## Do this (in order)

### 1) Locate or clone + build wrapper

```bash
cd <claudio>/claude-wrapper
bun build --compile ./claudio-wrapper.js --outfile claudio-wrapper-native15.exe
```

Use an incremented `nativeN` if an older `.exe` may be locked by Cursor.

Absolute path example (Windows):

`C:\Users\<user>\claudio\claude-wrapper\claudio-wrapper-native15.exe`

### 2) Write `~/.claude-native/providers.json`

Create/update with the user’s providers. Example shape:

```json
{
  "active": "opencode",
  "providers": {
    "opencode": {
      "baseUrl": "https://opencode.ai/zen/v1",
      "model": "big-pickle",
      "apiKeyEnv": "OPENAI_API_KEY",
      "apiKey": "<opencode-key-or-omit>",
      "tools": true,
      "models": [
        "big-pickle",
        "deepseek-v4-flash-free",
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
      "apiKey": "<cohere-key-or-omit>",
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

- Put the user’s preferred default first in `models[]` and in `providers.<active>.model`.
- Prefer `apiKeyEnv` + user env when possible.

### 3) Vision (images) — `~/.claude-native/.env`

If the user has a Groq key:

```bash
GROQ_API_KEY=gsk_...
CLAUDE_CODE_VISION_API_KEY=gsk_...
CLAUDE_CODE_VISION_BASE_URL=https://api.groq.com/openai/v1
CLAUDE_CODE_VISION_MODEL=qwen/qwen3.6-27b
CLAUDE_CODE_VISION_ROUTE=1
```

Without Groq, say clearly that pasting images will fail on text-only models.

### 4) Cursor User Settings JSON

Set (merge, don’t wipe unrelated settings):

| Key | Value |
|-----|--------|
| `claudeCode.claudeProcessWrapper` | Absolute path to the `.exe` from step 1 |
| `claudeCode.skipApiCheck` | `true` |
| `claudeCode.model` | e.g. `anthropic.big-pickle` |

### 5) Sync Claude settings

On first real spawn the wrapper syncs `availableModels` + `enforceAvailableModels` into `~/.claude/settings.json`.  
You may also set `~/.claude/settings.json` → `"model": "anthropic.<id>"` to match the default.  
Strip any leftover `env.CLAUDE_CODE_USE_OPENAI` / `OPENAI_*` routing keys if present.

### 6) Verify

1. Tell user: **Reload Window**
2. Open the **Claude Code** panel
3. Confirm picker lists `anthropic.*` ids from the catalog
4. Smoke text: short prompt → non-empty reply
5. Optional smoke image if Groq is configured
6. If debug needed: `CLAUDE_WRAPPER_DEBUG=1` and check `~/claude-native-debug.log` for `POST /v1/messages`

### 7) Report back

Give the user a short summary:

- Wrapper path
- Default model id
- Providers enabled
- Vision on/off
- What to click (Reload → Claude Code → send “hi”)

## Troubleshooting (fix, don’t just list)

| Symptom | Action |
|---------|--------|
| Still hits Anthropic / login wall | Fix `claudeProcessWrapper` → `.exe`, Reload |
| `EINVAL` on Windows | Wrong path to `.cmd` — use compiled `.exe` |
| Empty / hung replies | Check log; raise isn’t needed (bridge floors `max_tokens`); try another model |
| Images → 400 | Configure Groq `.env` (step 3) |
| OpenCode 500 on `big-pickle` | Provider/upstream flake (often internal); retry or switch model — not a local misconfig if `/chat/completions` is `opencode.ai/zen/v1` |
| `invalid bridge token` + `/login` warning | `/logout` or rebuild wrapper (quarantines `.credentials.json` while bridged); shared `~/.claude-native/bridge.token` |
| Need provider/model catalog | `node sync-catalog.js sync` then `list --bridge` / `list --models opencode` |

## Out of scope

- Do not publish keys to git or chat logs in full when summarizing.
- Stay focused on the Claude Code native wrapper; ignore unrelated extensions unless the user asks.
