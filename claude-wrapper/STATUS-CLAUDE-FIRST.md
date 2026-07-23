# Claude native — status

Thin wrapper: official Claude Code harness + local Anthropic→Chat bridge.

See **[SETUP-GUIDE.md](./SETUP-GUIDE.md)** for the full agent/human setup prompt (kept in sync with native mode).

## Current shape

- Wrapper binary: latest `claudio-wrapper-nativeN.exe` in this folder (point Cursor `claudeCode.claudeProcessWrapper` at it)
- Mode: `CLAUDE_WRAPPER_MODE=native` (default)
- Catalog: `~/.claude-native/providers.json`
- Vision: `~/.claude-native/.env` → Groq `qwen/qwen3.6-27b`
- Log: `~/claude-native-debug.log`

## Codius

Paused / separate. Do not mix with this wrapper unless the user asks to resume Codex bridging.
