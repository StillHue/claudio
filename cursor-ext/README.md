# Claudio — Cursor / VS Code extension

Opens Claudio in a full editor tab (terminal).

## Build / install

```bash
npm install
npm run build
npx @vscode/vsce package --no-dependencies --allow-missing-repository
```

Install the generated `.vsix` in Cursor/VS Code.

## Requirements

- `claude` or `claudio` on PATH (`npm install -g @gaburieuru/claudio@latest`)

## Settings

- `claudio.command` — default `claudio` (set to `claude` if you use that shim)
- `claudio.args` — extra CLI args
