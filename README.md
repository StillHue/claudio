# Claudio

**Claudio** is an open-source coding-agent CLI and Cursor/VS Code integration — Claude Code–style UX, any LLM provider.

Claudio is **not** an official Anthropic product. The CLI contains code derived from Claude Code; read [LICENSE](./LICENSE) before redistributing.

## What you get

| Piece | Role |
| --- | --- |
| **CLI** | Binary `claudio` — multi-LLM coding agent (sources in this repo’s CLI package) |
| **Cursor extension** | Activity Bar + editor-tab terminal |
| **Claude Code wrapper** | Optional process wrapper so the official Claude Code extension UI can launch Claudio via `claudeCode.claudeProcessWrapper` |

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

Publishing: pushes to `main` that bump the CLI `package.json` version above the npm registry version auto-publish `@gaburieuru/claudio` (GitHub Action; requires repo secret `NPM_TOKEN`).

## Quick start (from source)

```bash
# from the CLI package directory
bun install
bun run build
npm link
claudio --version
```

Configure providers with `/provider` or environment variables. Prefer a project-local `.env` (gitignored).

## Cursor / VS Code extension

```bash
# from the Cursor extension directory
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
2. Point `claudeCode.claudeProcessWrapper` at the wrapper script in this repo’s wrapper directory (absolute path on your machine).

On Unix, invoke the wrapper `.js` with `node` or add a small shell wrapper.

## License

MIT for Claudio-authored parts (extension, wrapper, branding/docs), **2026**.  
Claude Code–derived code: see [LICENSE](./LICENSE).

## Credits

- Anthropic — Claude Code (proprietary product / original lineage)
- Claude asterisk mark used for IDE chrome is brand-inspired; trademarks belong to their owners

## Contributing

1. Do not commit secrets, personal `.env`, or `node_modules`.
2. Keep user-facing brand strings as **Claudio**.
3. Prefer small, reviewable PRs.
4. Build the CLI package before opening a PR.
