---
name: provider
description: List inference providers, connect with an API key, and sync models into Claude Code (/model picker). Use when the user runs /provider or wants to switch OpenCode/Groq/OpenRouter/etc.
disable-model-invocation: true
allowed-tools: Bash, Read
argument-hint: "[provider-id]"
---

# /provider - connect a model provider

Wrapper dir (scripts live here): `{{WRAPPER_DIR}}`

## Goal

Let the user pick a **bridge-ready** provider, save an API key, load its models into `~/.claude-native/providers.json`, and sync the Claude Code `/model` picker.

## Steps

1. Refresh catalog (quiet):
   `node "{{WRAPPER_DIR}}/sync-catalog.js" sync`

2. If `$ARGUMENTS` is empty, show bridge-ready providers (first ~40 lines is enough):
   `node "{{WRAPPER_DIR}}/sync-catalog.js" list --bridge`

3. Ask the user which **provider id** they want (e.g. `opencode`, `groq`, `openrouter`, `cohere`). If `$ARGUMENTS` already has an id, use it.

4. **Do not ask them to paste the API key into chat** (it lands in history). Tell them to run this in a terminal (hidden input):

```powershell
node "{{WRAPPER_DIR}}/enable-provider.js" <provider-id> --prompt-key
```

Or, if they already exported the env var from the catalog (`apiKeyEnv`), they can run:

```powershell
node "{{WRAPPER_DIR}}/enable-provider.js" <provider-id>
```

5. After they confirm it ran, show models:
   `node "{{WRAPPER_DIR}}/sync-catalog.js" list --models <provider-id>`

6. Tell them to **restart Claude Code / Reload Window**, then use `/model` and pick `anthropic.<model-id>`.

## Rules

- Only enable providers marked bridge-ready (`*` in `list --bridge`).
- Never echo or log the raw API key.
- If they want Anthropic subscription instead of a gateway: say to remove/disable the active provider key and use `/login` (passthrough) — do not mix `/login` + bridge in the same session.
