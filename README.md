# Claudio

Official Claude Code, with inference sent through a local bridge to an OpenAI-compatible API. The provider and model live in `providers.json`.

The UI, tools, and permissions stay the official Claude Code harness. The bridge translates Anthropic Messages to Chat Completions, including images, and retries the same model once when the upstream body is empty or hides an error inside HTTP 200.

## Install

Windows, from this checkout:

```powershell
cd claude-wrapper
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

Reload the IDE window after install. Cursor and VS Code must launch `claude-wrapper.exe` (`shell:false`). A `.cmd` or `.js` wrapper fails with `spawn EINVAL`.

`install.ps1` compiles that exe with `bun build --compile` when it is missing.

## Config

| File | Role |
| --- | --- |
| `~/.claude/providers.json` | `active` provider, `model`, `baseUrl`, `apiKeyEnv` |
| `~/.claude/.env` | API key named by `apiKeyEnv` |

Start from `claude-wrapper/providers.example.json`. Details, tests, and the retry rules are in `claude-wrapper/README.md`.

## License

MIT. See [LICENSE](LICENSE).

Claudio is an independent project, not affiliated with Anthropic. "Claude" and "Claude Code" are trademarks of Anthropic PBC.
