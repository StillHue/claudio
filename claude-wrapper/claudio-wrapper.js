#!/usr/bin/env node
/**
 * Process wrapper for the official Claude Code VS Code / Cursor extension.
 * The extension sets pathToClaudeCodeExecutable to this wrapper and passes
 * its bundled launcher as executableArgs, typically:
 *   [node.exe, .../resources/claude-code/cli.js, ...userArgs]
 * or a single native binary path.
 *
 * We drop that launcher and run the local Claudio CLI instead.
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

/**
 * Bun --compile embeds scripts under a virtual __dirname. Prefer the
 * directory of the running .exe so sibling ../cli resolves.
 */
function wrapperBaseDir() {
  const execDir = path.dirname(process.execPath)
  const base = path.basename(process.execPath).toLowerCase()
  if (base.startsWith('claudio-wrapper') && base.endsWith('.exe')) {
    return execDir
  }
  if (typeof __dirname === 'string' && __dirname.length > 0) {
    return __dirname
  }
  return execDir
}

function resolveClaudioEntry() {
  const baseDir = wrapperBaseDir()
  const candidates = []

  // Prefer sibling checkout so unreleased fixes apply without npm publish.
  candidates.push(path.join(baseDir, '..', 'cli', 'bin', 'claudio'))

  const globalBins = (prefix) => {
    if (!prefix || !path.isAbsolute(prefix)) return
    candidates.push(path.join(prefix, 'node_modules', '@gaburieuru', 'claudio', 'bin', 'claudio'))
    candidates.push(path.join(prefix, 'node_modules', 'claudio', 'bin', 'claudio'))
  }

  if (process.env.APPDATA && path.isAbsolute(process.env.APPDATA)) {
    globalBins(path.join(process.env.APPDATA, 'npm'))
  }

  try {
    const prefix = execFileSync('npm', ['prefix', '-g'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5000,
    }).trim()
    globalBins(prefix)
  } catch {
    // ignore — npm may be unavailable in some IDE hosts
  }

  for (const c of candidates) {
    if (c && path.isAbsolute(c) && fs.existsSync(c)) return c
  }
  return null
}

function isNodeBinary(filePath) {
  if (!filePath || typeof filePath !== 'string') return false
  const base = path.basename(filePath).toLowerCase()
  return base === 'node' || base === 'node.exe'
}

function isExtensionClaudeLauncher(filePath) {
  if (!filePath || typeof filePath !== 'string') return false
  if (!path.isAbsolute(filePath)) return false
  const normalized = filePath.replace(/\\/g, '/').toLowerCase()
  // Extension-bundled JS entry: .../claude-code/.../cli.js (or similar).
  if (normalized.endsWith('/cli.js') && normalized.includes('claude')) return true
  // Extension native binary / helper paths.
  if (/claude-code|native-binary/i.test(normalized)) return true
  const base = path.basename(normalized)
  if (base === 'claude' || base === 'claude.exe') return true
  return false
}

/** Strip the extension's bundled [node, cli.js] or native binary prefix. */
function stripExtensionLauncher(argv) {
  const args = argv.slice()
  if (args.length === 0) return args

  if (isNodeBinary(args[0]) && args.length >= 2 && isExtensionClaudeLauncher(args[1])) {
    return args.slice(2)
  }

  if (isExtensionClaudeLauncher(args[0])) {
    return args.slice(1)
  }

  return args
}

function resolveNodeBinary() {
  // Prefer a real Node when this file is bun-compiled (execPath is the .exe).
  if (isNodeBinary(process.execPath)) {
    return process.execPath
  }

  const fromEnv = process.env.NODE_BINARY || process.env.npm_node_execpath
  if (fromEnv && path.isAbsolute(fromEnv) && fs.existsSync(fromEnv)) {
    return fromEnv
  }

  try {
    const which = process.platform === 'win32' ? 'where' : 'which'
    const out = execFileSync(which, ['node'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5000,
    })
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l && path.isAbsolute(l) && fs.existsSync(l))
    if (out) return out
  } catch {
    // fall through
  }

  // Last resort: common Windows install paths
  if (process.platform === 'win32') {
    const guesses = [
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs', 'node.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'node', 'node.exe'),
    ]
    for (const g of guesses) {
      if (g && fs.existsSync(g)) return g
    }
  }

  return null
}

let args = stripExtensionLauncher(process.argv.slice(2))

const entry = resolveClaudioEntry()
if (!entry) {
  console.error(
    '[claudio-wrapper] could not find Claudio binary.\n' +
      'Install globally: npm install -g @gaburieuru/claudio@latest',
  )
  process.exit(1)
}

if (process.env.CLAUDIO_WRAPPER_DEBUG === '1') {
  console.error(`[claudio-wrapper] using ${entry}`)
}

const nodeBinary = resolveNodeBinary()
if (!nodeBinary) {
  console.error(
    '[claudio-wrapper] could not find node.exe to launch Claudio.\n' +
      'Ensure Node.js is on PATH, or set NODE_BINARY to an absolute node path.',
  )
  process.exit(1)
}

const child = spawn(nodeBinary, [entry, ...args], {
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
