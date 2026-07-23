# Cursor Agent as a Claudio provider

Use your **Cursor subscription models** (Composer, Grok, Opus, etc.) as the LLM backend for Claudio, while Claudio keeps its own tool loop, permissions, and UI.

```
Claudio (tools + session)
  → OpenAI-compatible HTTP
    → cursor-api-proxy :8765
      → agent -p --mode ask (stream-json)
        → Cursor cloud models
```

This does **not** reverse-engineer Cursor’s internal protocol. It uses the public `agent` CLI behind a local OpenAI-shaped proxy.

## Prerequisites

1. **Node.js ≥ 22**
2. **Cursor Agent CLI** installed and logged in:
   ```bash
   agent login
   agent models
   ```
3. **Claudio** installed:
   ```bash
   npm install -g @gaburieuru/claudio@latest
   claudio --version
   ```
4. **Cursor Agent usage quota** (Pro / available Agent usage). Free-tier usage limits return `ActionRequiredError` from `agent -p`.

## Step 1 — Start the proxy (Windows)

From this repo:

```bat
claudio\cursor-provider\start-proxy.cmd
```

That launcher:

- Points `CURSOR_AGENT_BIN` at `agent-for-proxy.cmd` so the proxy spawns via `cmd.exe` (required on Windows so `agent login` auth works)
- Sets `CURSOR_BRIDGE_MODE=ask` (inference only — tools stay in Claudio)
- Sets `CURSOR_BRIDGE_CHAT_ONLY_WORKSPACE=0` (**required on Windows**: chat-only mode overrides `HOME`/`USERPROFILE` and breaks auth)

Proxy listens on **http://127.0.0.1:8765**.

Smoke tests:

```bash
curl http://127.0.0.1:8765/health
curl http://127.0.0.1:8765/v1/models
```

Manual chat (PowerShell — write JSON to a file to avoid escaping issues):

```powershell
[System.IO.File]::WriteAllText("$env:TEMP\cc.json", '{"model":"composer-2.5","messages":[{"role":"user","content":"Say hi"}],"stream":false}')
curl.exe -s -X POST http://127.0.0.1:8765/v1/chat/completions -H "Content-Type: application/json" --data-binary "@$env:TEMP\cc.json"
```

### macOS / Linux

```bash
export CURSOR_BRIDGE_MODE=ask
export CURSOR_BRIDGE_CHAT_ONLY_WORKSPACE=0
npx --yes cursor-api-proxy@latest
```

## Step 2 — Point Claudio at the proxy

Create or edit `~/.openclaude/.env` (Windows: `%USERPROFILE%\.openclaude\.env`):

```bash
CLAUDE_CODE_USE_OPENAI=1
OPENAI_BASE_URL=http://127.0.0.1:8765/v1
OPENAI_API_KEY=not-needed
OPENAI_MODEL=composer-2.5
```

Example file in-repo: [cursor-provider/openclaude.env.example](../cursor-provider/openclaude.env.example).

Claudio loads this file automatically on start. Verify in a terminal:

```bash
claudio --version
# then an interactive session, or:
# claudio -p --bare --tools "" "Say hi"
```

Pick any id from `GET /v1/models` / `agent --list-models` for `OPENAI_MODEL`.

## Step 3 — Official Claude Code panel in Cursor

Same process wrapper as [claude-wrapper/SETUP-GUIDE.md](../claude-wrapper/SETUP-GUIDE.md):

| Setting | Value |
|---------|--------|
| `claudeCode.claudeProcessWrapper` | Absolute path to `claudio-wrapper.exe` (or `claudio-wrapper-N.exe`) |
| `claudeCode.skipApiCheck` | `true` |
| `claudeCode.model` | Optional; e.g. `composer-2.5` |

1. Start `cursor-provider\start-proxy.cmd` and leave it running
2. Restart Cursor (or reload window) after settings changes
3. Open the Claude Code panel — it should route through Claudio → proxy → Cursor models

## Architecture notes

- **Claudio owns tools.** Proxy mode is `ask` so the Cursor Agent does not edit files or run shell on its own.
- **Auth** is your existing `agent login` (or `CURSOR_API_KEY`). The OpenAI client key can be `not-needed`.
- **Latency**: each completion may cold-start an `agent` subprocess.
- **Unofficial bridge**: [cursor-api-proxy](https://github.com/anyrobert/cursor-api-proxy) is community software; Cursor ToS / quota are your responsibility.
- **Fallback proxy**: if stream/tool shaping breaks, try [agentproxy](https://github.com/nirmalhk7/agentproxy) and keep the same `OPENAI_BASE_URL` pattern (adjust port).

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `Command not found: agent` | Install Cursor CLI; on Windows use `start-proxy.cmd` (sets `CURSOR_AGENT_BIN` shim) |
| `Authentication required` | Run `agent login`. On Windows ensure `CURSOR_BRIDGE_CHAT_ONLY_WORKSPACE=0` |
| `You've hit your usage limit` | Account quota — upgrade / wait for reset; pipeline is fine |
| Claudio ignores proxy | Confirm `~/.openclaude/.env` and that proxy is up on `:8765` |
| Panel still hits Anthropic | Confirm `claudeCode.claudeProcessWrapper` points at the `.exe`, restart Cursor |
| Images fail on text-only models | Use Groq vision routing (`CLAUDE_CODE_VISION_ROUTE=1` + `GROQ_API_KEY`) — see wrapper SETUP-GUIDE |

## Files

| Path | Purpose |
|------|---------|
| `cursor-provider/start-proxy.cmd` | Windows launcher for cursor-api-proxy |
| `cursor-provider/agent-for-proxy.cmd` | Shim so proxy uses `cmd.exe` + real `agent.cmd` |
| `cursor-provider/openclaude.env.example` | Sample Claudio env |
| `~/.openclaude/.env` | Live Claudio provider config |
| `claude-wrapper/` | Official Claude Code extension → Claudio process wrapper |
