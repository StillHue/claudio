---
name: provider
description: List providers, pick one, enter API key, sync models
disable-model-invocation: true
allowed-tools: Bash, Read
argument-hint: "[provider-id]"
---

# /provider

Interactive setup. Do this in order. Be short. No essays.

Wrapper: `{{WRAPPER_DIR}}`

## 1) Show the list

Run:

```bash
node "{{WRAPPER_DIR}}/sync-catalog.js" sync
node "{{WRAPPER_DIR}}/sync-catalog.js" list --bridge
```

Show the user a clean numbered list of **provider ids** (and model counts). Prefer the first ~30 bridge-ready rows unless they ask for more.

If `$ARGUMENTS` already has a provider id, skip the choice and go to step 3.

## 2) User picks one

Ask: which **provider id**? (example: `opencode`, `groq`, `openrouter`, `cohere`)

Wait for their answer.

## 3) User pastes API key

Ask them to paste the API key in the next message.

Then run (substitute id + key; do **not** print the key back in your reply):

```bash
node "{{WRAPPER_DIR}}/enable-provider.js" <provider-id> --key=<api-key>
```

## 4) Done

Tell them in 2–3 lines:

- provider enabled
- default model / picker id from the command output
- restart Claude Code (or Reload Window), then `/model` to switch models

## Rules

- Only bridge-ready providers from `list --bridge`.
- Never echo the raw API key in chat after they send it.
- If enable fails, show the error and ask for a different id/key.
