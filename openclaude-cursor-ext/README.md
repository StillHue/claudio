# Claudio — Cursor / VS Code extension

Opens Claudio in a full editor tab (terminal), similar to OpenCode’s editor experience.

## Build / install

```bash
# from this extension directory
npm install
npm run build
npx @vscode/vsce package --no-dependencies --allow-missing-repository
```

Install the generated `.vsix` in Cursor/VS Code.

## Requirements

- `claudio` on your PATH (`npm install -g @gaburieuru/claudio@latest`, or `npm link` after building the CLI)

## Settings

- `claudio.command` — default `claudio`
- `claudio.args` — extra CLI args
