# Test matrix

Offline suite lives in `claude-wrapper/scripts/`. Run from that directory:

```powershell
foreach ($t in @(Get-ChildItem test-*.js | Select-Object -ExpandProperty Name)) { node $t }
```

```bash
for t in test-*.js; do node "$t" || echo "FAIL: $t"; done
```

## Offline tests (no keys, no network)

| Test | Covers |
|---|---|
| `test-count-tokens.js` | `/count_tokens` hardening |
| `test-response-dedupe.js` | stream/text dedupe |
| `test-stream-short-token-dedupe.js` | short-token delta regression ("letra comida") |
| `test-text-block-single-stop.js` | single text-block stop events |
| `test-translate-hardening.js` | Anthropic→OpenAI translation edge cases |
| `test-upstream-error-sanitize.js` | secret redaction in error summaries |
| `test-stream-error.js` | 503-smuggled-in-200 → 1 retry → real `503` status + message, never the empty notice |
| `test-resolve-official.js` | binary resolution: `*-server` roots, npm global `cli.js` probed via node |

## After changing bridge code

1. Run the offline suite above — must be all green.
2. Rebuild the Windows binary: `bun build --compile ./claude-wrapper.js --outfile ./claude-wrapper.exe`
   (swap while no bridge holds the file, then smoke-test with `claude-wrapper.exe --version`).
3. Kill live `claude-wrapper.exe` bridges so sessions respawn on the new binary.
