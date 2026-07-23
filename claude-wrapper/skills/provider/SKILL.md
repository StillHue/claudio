---
name: provider
description: Open provider setup UI (pick provider + API key)
disable-model-invocation: true
allowed-tools: Bash
---

# /provider

Open the **local provider UI**. Do not ask for an API key in chat.

## Do this

1. Run (blocks until the user finishes or closes the UI):

```bash
node "{{WRAPPER_DIR}}/provider-ui.js"
```

2. Tell the user briefly: a browser page opened on `127.0.0.1` — pick provider, paste key there, save. Key does **not** go into this chat.

3. When the command exits, say: restart Claude Code / Reload Window, then use `/model`.

## Rules

- Never ask them to paste the API key in Claude chat.
- If the command fails, show the error and suggest running `node "{{WRAPPER_DIR}}/provider-ui.js"` in a terminal.
