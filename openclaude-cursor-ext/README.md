# Claudio Sidebar (Cursor / VS Code)

Activity Bar icon that opens **Claudio** in a full editor tab (OpenCode-style).

## Install

```bash
cd openclaude-cursor-ext
npm install
npm run build
npx @vscode/vsce package --no-dependencies --allow-missing-repository
# then: cursor --install-extension ./claudio-sidebar-0.1.0.vsix --force
```

Reload the window (**Developer: Reload Window**).

## Requirements

- `claudio` on your PATH (`npm link` from `openclaude-fork` after build)

## Config

- `claudio.command` (default: `claudio`)
- `claudio.args`
