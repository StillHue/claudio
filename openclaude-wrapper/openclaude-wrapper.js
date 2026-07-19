#!/usr/bin/env node
/**
 * Process wrapper for the official Claude Code VS Code extension.
 * The extension passes its bundled binary path as the FIRST argument;
 * we drop it and run the local Claudio CLI instead, forwarding the rest.
 *
 * Configured via VS Code setting: claudeCode.claudeProcessWrapper
 *
 * Security: never spawn with shell:true + forwarded argv (command injection).
 * Only executes an absolute path to bin/claudio via process.execPath (Node).
 */
const { spawn, execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

function resolveClaudioEntry() {
  const candidates = []

  // Prefer npm global install only when APPDATA is a real absolute dir (Windows).
  if (process.env.APPDATA && path.isAbsolute(process.env.APPDATA)) {
    candidates.push(
      path.join(process.env.APPDATA, 'npm', 'node_modules', 'claudio', 'bin', 'claudio'),
    )
  }

  // Sibling checkout in this monorepo
  candidates.push(path.join(__dirname, '..', 'openclaude-fork', 'bin', 'claudio'))

  // Unix-style npm prefix (when available)
  try {
    const prefix = execFileSync('npm', ['prefix', '-g'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5000,
    }).trim()
    if (prefix && path.isAbsolute(prefix)) {
      candidates.push(path.join(prefix, 'node_modules', 'claudio', 'bin', 'claudio'))
    }
  } catch {
    // ignore — npm may be unavailable in some IDE hosts
  }

  for (const c of candidates) {
    if (c && path.isAbsolute(c) && fs.existsSync(c)) return c
  }
  return null
}

let args = process.argv.slice(2)

if (args.length > 0) {
  const first = args[0]
  const looksLikeBinary =
    path.isAbsolute(first) &&
    (fs.existsSync(first) || /claude|native-binary/i.test(first))
  if (looksLikeBinary) args = args.slice(1)
}

const entry = resolveClaudioEntry()
if (!entry) {
  console.error(
    '[claudio-wrapper] could not find Claudio binary.\n' +
      'Build and link it first:\n' +
      '  cd openclaude-fork && bun run build && npm link',
  )
  process.exit(1)
}

const child = spawn(process.execPath, [entry, ...args], {
  stdio: 'inherit',
  env: process.env,
  windowsHide: true,
})

child.on('exit', (code, signal) => {
  if (signal) {
    try {
      process.kill(process.pid, signal)
    } catch {
      process.exit(1)
    }
  }
  process.exit(code ?? 0)
})
child.on('error', (err) => {
  console.error('[claudio-wrapper] failed to start Claudio:', err.message)
  process.exit(1)
})
