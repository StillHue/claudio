# cursor-provider

Windows helpers to run [cursor-api-proxy](https://github.com/anyrobert/cursor-api-proxy) so Claudio can use Cursor Agent models.

## Quick start

1. `agent login` (once)
2. Double-click or run `start-proxy.cmd` — listens on `http://127.0.0.1:8765`
3. Copy `openclaude.env.example` into `%USERPROFILE%\.openclaude\.env`
4. Run `claudio` (or the Claude Code panel with the process wrapper)

Full guide: [../docs/cursor-agent-provider.md](../docs/cursor-agent-provider.md)

## Files

| File | Role |
|------|------|
| `start-proxy.cmd` | Starts the proxy with Windows-safe env (`ask` mode, chat-only off) |
| `agent-for-proxy.cmd` | Shim so the proxy spawns real `agent.cmd` via `cmd.exe` |
| `openclaude.env.example` | Sample Claudio `.env` pointing at the proxy |
