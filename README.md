# Claudio

Customização local do [OpenClaude](https://github.com/Gitlawb/openclaude) com estética Claude Code, extensão para Cursor/VS Code e integração com a extensão oficial do Claude Code.

## Estrutura

| Pasta | O quê |
| --- | --- |
| `openclaude-fork/` | Fork do OpenClaude — splash/cores estilo Claude Code, mascote Clawd, nome "OpenClaude" |
| `openclaude-cursor-ext/` | Extensão Cursor/VS Code — ícone na Activity Bar e CLI em aba de editor (estilo OpenCode) |
| `openclaude-wrapper/` | Wrapper para `claudeCode.claudeProcessWrapper` — a UI oficial do Claude Code roda o OpenClaude por baixo |

## Setup rápido

### 1. CLI (fork)

```powershell
cd openclaude-fork
bun install   # ou npm install, conforme o lock do fork
bun run build
npm link
openclaude --version
```

### 2. Extensão sidebar / editor tab

```powershell
cd openclaude-cursor-ext
npm install
npm run build
npx @vscode/vsce package --no-dependencies --allow-missing-repository
cursor --install-extension .\openclaude-sidebar-0.1.0.vsix --force
```

Depois: **Developer: Reload Window**.

### 3. UI oficial do Claude Code + motor OpenClaude

1. Instale a extensão `anthropic.claude-code`.
2. Em Settings, defina:

```json
"claudeCode.claudeProcessWrapper": "C:\\Users\\gabdr\\claudio\\openclaude-wrapper\\openclaude-wrapper.cmd"
```

(Ajuste o caminho absoluto se a pasta não estiver em `C:\Users\gabdr\claudio`.)

O wrapper descarta o binário embutido da extensão e executa o `openclaude` linkado globalmente.

## Notas

- O fork parte do OpenClaude upstream; mudanças locais focam em branding/startup e integração IDE.
- Não commite `.env`, tokens nem `node_modules`.
- Licença e créditos do código base: ver `openclaude-fork/` (upstream OpenClaude / origem Anthropic Claude Code conforme aplicável).
