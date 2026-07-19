# OpenClaude Sidebar (Cursor / VS Code)

Ícone na Activity Bar que abre o **OpenClaude** embutido numa sidebar (xterm + PTY), com o asterisco estilo Claude.

## Instalar

```powershell
cd C:\Users\gabdr\openclaude-cursor-ext
npm install
npm run build
npx --yes @vscode/vsce package --allow-missing-repository
cursor --install-extension .\openclaude-sidebar-0.1.0.vsix
```

Depois: **Developer: Reload Window**, e clique no ícone OpenClaude na barra esquerda.

## Requisitos

- `openclaude` no PATH (seu fork linkado via `npm link` serve)
- No Windows, `node-pty` usa ConPTY

## Config

- `openclaude.command` (default: `openclaude`)
- `openclaude.args` (lista de argumentos extras)
