# Claudio

Official Claude Code, with inference sent through a local bridge to an OpenAI-compatible API. The provider and model live in `providers.json`.

The UI, tools, and permissions stay the official Claude Code harness. The bridge translates Anthropic Messages to Chat Completions, including images, and retries the same model once when the upstream body is empty or hides an error inside HTTP 200.

## Install

### macOS

Choose either installation method. Both require Node.js/npm and `curl`.

**Using npm** (the package is installed from GitHub; the installer runs automatically):

```sh
npm install --global github:StillHue/claudio
```

**From a checkout:**

```sh
git clone https://github.com/StillHue/claudio.git
cd claudio
bash ./claude-wrapper/install.sh
```

The installer installs official Claude Code if needed, deploys the wrapper, and configures settings for installed IDEs using a shell launcher compatible with the Claude Code SDK. Reload the IDE window after install.

### Windows

From this checkout:

```powershell
cd claude-wrapper
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

Cursor and VS Code must launch `claude-wrapper.exe` (`shell:false`). A `.cmd` or `.js` wrapper fails with `spawn EINVAL`.

On first launch with no API key, a local setup page opens. No model has to be registered before then. The key goes to `~/.claude/.env`; the provider and model go to `~/.claude/wrapper/providers.json`.

On Windows, build the exe before install, from `claude-wrapper/`: `bun build --compile ./claude-wrapper.js --outfile ./claude-wrapper.exe`.

## Config

| File | Role |
| --- | --- |
| `~/.claude/wrapper/providers.json` | `active` provider, `model`, `baseUrl`, `apiKeyEnv` |
| `~/.claude/.env` | API key named by `apiKeyEnv` |

Start from `claude-wrapper/providers.example.json`. Details, tests, and the retry rules are in `claude-wrapper/README.md`.

## License

MIT. See [LICENSE](LICENSE).

Claudio is an independent project, not affiliated with Anthropic. "Claude" and "Claude Code" are trademarks of Anthropic PBC.
