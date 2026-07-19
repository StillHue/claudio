# Claudio

**Claudio** is an open-source coding-agent CLI and Cursor/VS Code integration — Claude Code–style UX, any LLM provider.

Claudio is **not** an official Anthropic product. The CLI contains code derived from Claude Code; read [LICENSE](./LICENSE) and `cli/LICENSE` (under `openclaude-fork/LICENSE`) before redistributing.

## What you get

| Path | Role |
| --- | --- |
| `openclaude-fork/` | CLI binary **`claudio`** — multi-LLM coding agent |
| `openclaude-cursor-ext/` | Cursor/VS Code extension — Activity Bar + editor-tab terminal |
| `openclaude-wrapper/` | Optional wrapper so the official Claude Code extension UI can launch **Claudio** via `claudeCode.claudeProcessWrapper` |

## Security

- **Never commit API keys, tokens, or `.env` files.**
- Provider keys belong in your environment or OS keychain — not in this repo.
- Treat the `claudio` binary like any privileged developer tool.
- Report security issues privately; never open issues that include live credentials.

## Requirements

- Node.js **≥ 22**
- [Bun](https://bun.sh) recommended for building the CLI
- Windows, macOS, or Linux

## Install (no clone needed)

```bash
npm install -g @gaburieuru/claudio@latest
# or
bun install -g @gaburieuru/claudio@latest

claudio
```

Publishing: pushes to `main` that bump `openclaude-fork/package.json` `version` above the npm registry version auto-publish `@gaburieuru/claudio` via `.github/workflows/publish-claudio-npm.yml` (requires repo secret `NPM_TOKEN`).

## Quick start (from source)

```bash
cd openclaude-fork
bun install
bun run build
npm link
claudio --version
```

Configure providers with `/provider` or environment variables. Prefer a project-local `.env` (gitignored). Docs live under `openclaude-fork/docs/`.

## Cursor / VS Code extension

```bash
cd openclaude-cursor-ext
npm install
npm run build
npx @vscode/vsce package --no-dependencies --allow-missing-repository
# Install the generated .vsix into Cursor/VS Code
```

Settings (optional):

- `claudio.command` — default `claudio`
- `claudio.args` — extra CLI args

## Official Claude Code UI → Claudio engine

1. Install the marketplace extension `anthropic.claude-code`.
2. Point the process wrapper at this repo’s script (adjust the absolute path):

```json
{
  "claudeCode.claudeProcessWrapper": "C:\\Users\\YOU\\claudio\\openclaude-wrapper\\openclaude-wrapper.cmd"
}
```

On Unix, invoke the `.js` with `node` or add a small shell wrapper.

## License

MIT for Claudio-authored parts (extension, wrapper, branding/docs), **2026**.  
Claude Code–derived code: see [LICENSE](./LICENSE) and `openclaude-fork/LICENSE`.

## Credits

- Anthropic — Claude Code (proprietary product / original lineage)
- Claude asterisk mark used for IDE chrome is brand-inspired; trademarks belong to their owners

## Contributing

1. Do not commit secrets, personal `.env`, or `node_modules`.
2. Keep user-facing brand strings as **Claudio**.
3. Prefer small, reviewable PRs.
4. Run `bun run build` in `openclaude-fork` before opening a PR.
