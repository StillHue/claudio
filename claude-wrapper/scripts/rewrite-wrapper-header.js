#!/usr/bin/env node
/**
 * Rewrite claudio-wrapper.js header to use lib/wrapper/* modules.
 */
const fs = require('fs')
const path = require('path')

const file = path.join(__dirname, '..', 'claudio-wrapper.js')
const src = fs.readFileSync(file, 'utf8')
const marker = 'function resolveClaudioEntry()'
const idx = src.indexOf(marker)
if (idx < 0) throw new Error('resolveClaudioEntry not found')

const header = `#!/usr/bin/env node
/**
 * Process wrapper for the official Claude Code VS Code / Cursor extension.
 *
 * Modes (CLAUDE_WRAPPER_MODE):
 *   native  — keep official Claude Code harness; only swap inference via local
 *             Anthropic Messages → Chat Completions bridge (default when the
 *             extension passes its bundled claude.exe / cli.js).
 *   claudio — replace Claude Code with the Claudio CLI (legacy).
 *
 * Configured via: claudeCode.claudeProcessWrapper
 *
 * On Windows, point the setting at claudio-wrapper.exe (bun --compile), not
 * .cmd — Node spawn() of .cmd without shell yields EINVAL.
 *
 * Security: never spawn with shell:true + forwarded argv (command injection).
 */
const { spawn, execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const { startNativeBridge } = require('./native-bridge')
const {
  loadProvidersConfig,
  resolveProvider,
  syncDefaultModel,
} = require('./provider-config')
const {
  resolveLatestOfficialClaude,
  preferLatestOfficial,
} = require('./resolve-official-claude')
const { debugLog } = require('./lib/wrapper/log')
const {
  loadNativeEnvFiles,
  wrapperBaseDir,
  getSharedBridgeToken,
} = require('./lib/wrapper/env')
const {
  quarantineClaudeLoginCredentials,
  restoreClaudeLoginCredentials,
} = require('./lib/wrapper/credentials')

`

const out = header + src.slice(idx)
fs.writeFileSync(file, out)
console.log('rewrote', file, 'bytes', out.length)
