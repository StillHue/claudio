# How to Configure the Claudio Wrapper for Cursor

This guide walks an AI agent (or a human) through setting up the Claudio process wrapper so the **official Claude Code Cursor extension** runs Claudio instead of Claude Code.

## What the Wrapper Does

The Claude Code Cursor extension launches a Claude Code process via a configurable executable path. The wrapper intercepts that launch, strips the extension's bundled launcher, and runs the local Claudio CLI instead — giving you access to any LLM provider (OpenAI, Ollama, OpenCode Zen, DeepSeek, etc.) from inside Cursor's Claude Code panel.

```
Cursor Claude Code extension
  → spawns claudio-wrapper.exe (instead of Claude Code)
    → wrapper strips extension launcher args
    → wrapper spawns: node <claudio-entry> [...userArgs]
      → Claudio runs with your provider config
```

## Prerequisites

1. **Node.js >= 22** installed and on PATH
2. **Claudio installed globally**:
   ```bash
   npm install -g @gaburieuru/claudio@latest
   ```
3. **Claudio working from terminal** — verify with `claudio --version`
4. **The official Claude Code extension installed in Cursor** (publisher: `anthropic.claude-code`)

## Step 1 — Build or Locate the Wrapper

### Option A: Use the pre-built executable (recommended)

The wrapper ships as a compiled Bun executable at:

```
claudio/claude-wrapper/claudio-wrapper.exe
```

If you installed from npm globally, check:

```
C:\Users\<you>\AppData\Roaming\npm\node_modules\@gaburieuru\claudio\claude-wrapper\claudio-wrapper.exe
```

### Option B: Build from source

```bash
cd claudio/claude-wrapper
bun build claudio-wrapper.js --compile --outfile claudio-wrapper.exe
```

> **Windows note**: Use the `.exe`, not `.cmd`. Node's `spawn()` without `shell:true` on a `.cmd` file yields `EINVAL`.

## Step 2 — Configure Cursor

Open Cursor Settings (`Ctrl+,`) and search for `claudeCode`. You need to set **three** things:

### 2a. Process Wrapper Path

Setting: `claudeCode.claudeProcessWrapper`

Set this to the **absolute path** of `claudio-wrapper.exe`:

```
C:\Users\<you>\claudio\claude-wrapper\claudio-wrapper.exe
```

Or if installed globally via npm:

```
C:\Users\<you>\AppData\Roaming\npm\node_modules\@gaburieuru\claudio\claude-wrapper\claudio-wrapper.exe
```

### 2b. Skip API Check (recommended)

Setting: `claudeCode.skipApiCheck`

Set to `true` so the extension doesn't reject Claudio's provider setup.

### 2c. Model (optional)

Setting: `claudeCode.model`

Override the model the extension sends to Claudio. You can also let Claudio handle model selection via its own config.

## Step 3 — Configure Claudio Provider

The wrapper passes your environment to Claudio. Configure your provider via one of these methods:

### Method A: Claudio profile (recommended)

Run `claudio` in a terminal and use `/provider` for guided setup. This saves credentials to `~/.openclaude/settings.json`.

### Method B: Environment variables

Create `~/.openclaude/.env` with your provider config:

```bash
# Example: OpenCode Zen (48 models, pay-as-you-go)
CLAUDE_CODE_USE_OPENAI=1
OPENAI_BASE_URL=https://opencode.ai/zen/v1
OPENAI_MODEL=deepseek-v4-flash-free
OPENCODE_API_KEY=your-key-here

# Example: OpenAI direct
# CLAUDE_CODE_USE_OPENAI=1
# OPENAI_API_KEY=sk-your-key-here
# OPENAI_MODEL=gpt-4o

# Example: Ollama local
# CLAUDE_CODE_USE_OPENAI=1
# OPENAI_BASE_URL=http://localhost:11434/v1
# OPENAI_MODEL=qwen2.5-coder:7b
```

### Method C: Vision routing (for image support on text-only models)

If your model doesn't support vision (e.g., DeepSeek, GLM), add Groq vision routing:

```bash
# In ~/.openclaude/.env
GROQ_API_KEY=gsk_your-groq-key-here
CLAUDE_CODE_VISION_ROUTE=1
```

This describes images via Groq's `qwen/qwen3.6-27b` before sending text to your main model.

To use a different vision model:

```bash
CLAUDE_CODE_VISION_MODEL=qwen/qwen3.6-27b
```

## Step 4 — Verify

1. Open Cursor
2. Open the Claude Code panel (Activity Bar icon or `Ctrl+Shift+P` → "Claude: Open")
3. Type a message — it should reach your configured provider
4. Check the terminal output for `[claudio-wrapper] using ...` if you set `CLAUDIO_WRAPPER_DEBUG=1`

### Debug mode

```bash
# In ~/.openclaude/.env
CLAUDIO_WRAPPER_DEBUG=1
```

This prints the resolved Claudio entry path to stderr on every launch.

## Troubleshooting

### "could not find Claudio binary"

The wrapper can't find the Claudio CLI. Fix:

```bash
npm install -g @gaburieuru/claudio@latest
claudio --version  # verify it works
```

### "could not find node.exe"

Node.js isn't on PATH for the wrapper's environment. Fix:

- Ensure Node.js >= 22 is installed
- Set `NODE_BINARY` env var to the absolute path of `node.exe`
- Or reinstall Node.js and check "Add to PATH"

### Extension still launches Claude Code

- Confirm `claudeCode.claudeProcessWrapper` points to the `.exe` (not `.cmd`)
- Restart Cursor after changing settings
- Check Cursor's output panel for errors

### Provider errors / 401 / 403

- Verify your API key in `~/.openclaude/.env` or via `/provider`
- Check that `OPENAI_BASE_URL` matches your provider's endpoint
- Run `claudio` directly in terminal to isolate whether it's a wrapper or provider issue

### Images not working (400 error from provider)

If you see `unknown variant image_url` or similar, your model doesn't support vision. Add Groq vision routing (see Step 3, Method C).

## Architecture Notes

- The wrapper is a **process-level interceptor** — it replaces the executable the extension spawns
- It does **not** modify Claudio's source code or config
- Environment variables flow: Cursor → wrapper → Claudio → `.env` file load
- The wrapper uses `stdio: 'inherit'` — all input/output passes through transparently
- On Windows, always use the `.exe` compiled with `bun --compile`, not the `.cmd` shim

## Files Reference

| File | Purpose |
|------|---------|
| `claude-wrapper/claudio-wrapper.js` | Wrapper source (Node.js) |
| `claude-wrapper/claudio-wrapper.exe` | Compiled wrapper (Bun) |
| `claude-wrapper/_wire-vision-env.mjs` | Helper to write Groq keys to settings.json |
| `~/.openclaude/.env` | Claudio provider config + vision routing |
| `~/.openclaude/settings.json` | Claudio persistent settings |
