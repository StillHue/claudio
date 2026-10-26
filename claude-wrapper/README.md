# wrapper/

Claude Code (harness oficial) + inferência third-party via bridge local
Anthropic Messages → OpenAI Chat Completions.

## Rodar

| Comando | O quê |
| --- | --- |
| `npm test` | suíte offline em `scripts/test-*.js` |
| `npm run build` | `bun build --compile` → `claude-wrapper.exe` |

**Toda mudança em JS precisa de `npm run build`** — o IDE executa o `.exe`
compilado, não o `.js`.

## Config

`~/.claude/wrapper/providers.json` (provider ativo + modelo) e `~/.claude/.env` (chaves).
Trocar de provider = editar `providers.json` (`active`); nada é hard-coded.

## Mapa

| Path | Papel |
| --- | --- |
| `claude-wrapper.js` | entry: resolve binário oficial, sobe bridge, spawna Claude |
| `claude-cli.js` | entry terminal (lê `settings.json` env, tolera JSONC) |
| `native-bridge.js` | HTTP local Anthropic-shaped + gate de token |
| `lib/bridge/` | tradução, stream SSE, um retry do mesmo modelo |
| `lib/provider/` | resolução de model id, sync de settings |
| `lib/wrapper/` | env, paths, credentials, log |
| `scripts/test-*.js` | suíte offline (sem rede) |

## Garantias cobertas por teste

- vazio do upstream ou erro dentro de HTTP 200 → 1 retry do mesmo modelo, depois o status real (502 se continuar vazio)
- falhas transitórias do upstream (429/500/502/503/504) → 1 retry do mesmo modelo antes de repassar o status
- tradução Anthropic → OpenAI, incluindo imagem como `image_url`
- dedupe de stream sem comer token curto
- segredos saem redigidos do log

## Notas

- `.exe` é obrigatório no IDE (`shell:false`); `.cmd` dá `EINVAL`
- `install.ps1` compila o `.exe` via bun se faltar; não re-rode cegamente
- `login`/`auth`/`--help`/`doctor` passam direto ao binário oficial (sem bridge)
