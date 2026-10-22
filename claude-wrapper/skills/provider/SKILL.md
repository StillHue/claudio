---
name: provider
description: Change the wrapper provider and model in providers.json
disable-model-invocation: true
---

# /provider

The bridge reads `~/.claude/wrapper/providers.json` and the key from `~/.claude/.env`.

## Do this

1. Read `providers.json`.
2. Set `active` to the provider name, and that provider's `model` plus `models` to the upstream model id.
3. The API key stays in `~/.claude/.env` under the name in `apiKeyEnv`. Never ask for the key in chat.
4. Tell the user to reload the IDE window so the picker picks up the new model.
