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
| `test-fallback-cascade.js` | end-to-end cascade wiring with mocked fetch: single-model = try + 1 retry + honest notice, no fallback |
| `test-stream-error.js` | 503-smuggled-in-200 → 1 retry → real `503` status + message, never the empty notice |
| `test-resolve-official.js` | binary resolution: `*-server` roots, npm global `cli.js` probed via node |
| `test-local-auto-router.js` | provider auto-routing |

## Live probes (need keys/network, excluded from the offline pass)

| Test | Covers |
|---|---|
| `test-upstream-probe.js` | both cascade models, tiny prompt: content vs empty vs HTTP error |
| `test-capture-empty.js` | captures the raw SSE body of an empty turn (how the 503-in-200 was found) |
| `test-upstream-latency.js` | TTFB / first-text / total per model |
| `test-wrapper-parity-jeV.js` | TypeSafe Jev composite scoring vs official gateway behavior (needs `TYPESAFE_API_KEY` in `~/.claude/.env`) |
| `test-ddg-search.mjs` | web-search provider fallback paths |

## After changing bridge code

1. Run the offline suite above — must be all green.
2. Rebuild the Windows binary: `bun build --compile ./claudio-wrapper.js --outfile ./claudio-wrapper.exe`
   (verify the fix string is inside, swap while no bridge holds the file,
   smoke-test with `claudio-wrapper.exe --version`).
3. Kill live `claudio-wrapper.exe` bridges so sessions respawn on the new binary.
