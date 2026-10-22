/**
 * Canonical paths for the Claude Code + wrapper install on this machine.
 *
 * Official Claude Code home: ~/.claude
 * Wrapper runtime:           ~/.claude/wrapper
 * Config (providers, .env):  ~/.claude  (with legacy ~/.claude-native fallback)
 */
const fs = require('fs')
const path = require('path')
const os = require('os')

function claudeHomeDir() {
  return path.join(os.homedir(), '.claude')
}

function wrapperInstallDir() {
  return path.join(claudeHomeDir(), 'wrapper')
}

/** Legacy home used before centralizing under ~/.claude */
function legacyNativeHomeDir() {
  return path.join(os.homedir(), '.claude-native')
}

function ensureDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch {
    /* ignore */
  }
  return dir
}

/**
 * Prefer ~/.claude, then ~/.claude-native, then optional extras that exist.
 */
function configCandidates(fileName, extras = []) {
  return [
    path.join(claudeHomeDir(), fileName),
    path.join(legacyNativeHomeDir(), fileName),
    ...extras,
  ]
}

function envFileCandidates(extras = []) {
  return configCandidates('.env', extras)
}

function bridgeTokenPath() {
  ensureDir(wrapperInstallDir())
  const modern = path.join(wrapperInstallDir(), 'bridge.token')
  const legacy = path.join(legacyNativeHomeDir(), 'bridge.token')
  if (!fs.existsSync(modern) && fs.existsSync(legacy)) {
    try {
      fs.copyFileSync(legacy, modern)
    } catch {
      /* ignore */
    }
  }
  return modern
}

function wrapperStatePath(fileName) {
  ensureDir(wrapperInstallDir())
  return path.join(wrapperInstallDir(), fileName)
}

module.exports = {
  claudeHomeDir,
  wrapperInstallDir,
  ensureDir,
  envFileCandidates,
  bridgeTokenPath,
  wrapperStatePath,
}
