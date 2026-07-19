#!/usr/bin/env node
/**
 * Process wrapper for the official Claude Code VS Code extension.
 * The extension passes its bundled binary path as the FIRST argument;
 * we drop it and run the local OpenClaude CLI instead, forwarding the rest.
 *
 * Configured via VS Code setting: claudeCode.claudeProcessWrapper
 */
const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')

const OPENCLAUDE_ENTRY = path.join(
  process.env.APPDATA || 'C:\\Users\\gabdr\\AppData\\Roaming',
  'npm',
  'node_modules',
  '@gitlawb',
  'openclaude',
  'bin',
  'openclaude',
)

let args = process.argv.slice(2)

// Per Claude Code docs, the bundled binary path is prepended when the
// wrapper is set. Drop it only if it actually looks like that path.
if (args.length > 0) {
  const first = args[0]
  const looksLikeBinary =
    path.isAbsolute(first) &&
    (fs.existsSync(first) || /claude|native-binary/i.test(first))
  if (looksLikeBinary) args = args.slice(1)
}

const child = spawn(process.execPath, [OPENCLAUDE_ENTRY, ...args], {
  stdio: 'inherit',
  env: process.env,
})

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  process.exit(code ?? 0)
})
child.on('error', (err) => {
  console.error('[openclaude-wrapper] failed to start OpenClaude:', err.message)
  process.exit(1)
})
