# Claudio VS Code extension (bundled)

Launch Claudio from VS Code / Cursor with provider-aware Control Center, in-editor chat, theme support, and optional Microsoft Foundry / Azure OpenAI configuration injected into launched terminals.

## Requirements

- `claudio` on PATH (`npm install -g @gaburieuru/claudio@latest`)

## Azure / Foundry

1. Command Palette → **Claudio: Configure Azure / Foundry Chat (wizard)** (endpoint, API version, deployment, API key), or use **Claudio: Set Azure / Foundry API Key**.
2. Launch Claudio from the extension so the terminal receives the injected env.

If you already use a saved provider profile for the same workspace, leave Azure injection off to avoid conflicting provider configuration.

## Settings

See the extension Settings UI for launch command, terminal name, OpenAI shim, Azure injection, and permission mode. Defaults launch `claudio`.
