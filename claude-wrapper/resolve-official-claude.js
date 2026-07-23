/**
 * Resolve the newest official Anthropic Claude Code binary on this machine.
 * Shared by Cursor process-wrapper and terminal CLI shim.
 */
const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const os = require('os')

function parseSemver(text) {
  if (!text || typeof text !== 'string') return null
  const m = text.match(/(\d+)\.(\d+)\.(\d+)/)
  if (!m) return null
  return { major: +m[1], minor: +m[2], patch: +m[3], raw: `${m[1]}.${m[2]}.${m[3]}` }
}

function compareSemver(a, b) {
  if (!a && !b) return 0
  if (!a) return -1
  if (!b) return 1
  if (a.major !== b.major) return a.major - b.major
  if (a.minor !== b.minor) return a.minor - b.minor
  return a.patch - b.patch
}

function versionFromPath(filePath) {
  const norm = String(filePath || '').replace(/\\/g, '/')
  const m = norm.match(/anthropic\.claude-code-(\d+\.\d+\.\d+)/i)
  if (m) return parseSemver(m[1])
  return null
}

function versionFromBinary(filePath) {
  try {
    const out = execFileSync(filePath, ['--version'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 4000,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return parseSemver(out) || parseSemver(String(out).trim())
  } catch {
    return null
  }
}

function probeCandidate(filePath) {
  if (!filePath || !path.isAbsolute(filePath) || !fs.existsSync(filePath)) return null
  let mtime = 0
  try {
    mtime = fs.statSync(filePath).mtimeMs || 0
  } catch {
    mtime = 0
  }
  // Prefer folder semver for extension bundles (avoid spawning each binary).
  // Exec --version only for bare installs like ~/.local/bin/claude.exe.
  const fromPath = versionFromPath(filePath)
  const version =
    fromPath ||
    versionFromBinary(filePath) ||
    { major: 0, minor: 0, patch: 0, raw: '0.0.0' }
  return { path: filePath, version, mtime }
}

function listExtensionClaudeBinaries() {
  const homes = [os.homedir()]
  const roots = []
  for (const home of homes) {
    roots.push(path.join(home, '.cursor', 'extensions'))
    roots.push(path.join(home, '.vscode', 'extensions'))
  }
  const out = []
  for (const root of roots) {
    if (!fs.existsSync(root)) continue
    let dirs = []
    try {
      dirs = fs.readdirSync(root).filter((d) => d.startsWith('anthropic.claude-code-'))
    } catch {
      continue
    }
    for (const d of dirs) {
      const arch = process.arch === 'ia32' ? 'ia32' : process.arch
      const candidates = [
        path.join(root, d, 'resources', 'native-binary', 'claude.exe'),
        path.join(root, d, 'resources', 'native-binary', 'claude'),
        path.join(root, d, 'resources', 'native-binaries', `win32-${arch}`, 'claude.exe'),
        path.join(root, d, 'resources', 'native-binaries', `linux-${arch}`, 'claude'),
        path.join(root, d, 'resources', 'native-binaries', `darwin-${arch}`, 'claude'),
      ]
      for (const c of candidates) {
        if (fs.existsSync(c)) out.push(c)
      }
    }
  }
  return out
}

/**
 * @returns {{ path: string, version: {major:number,minor:number,patch:number,raw:string}, mtime: number } | null}
 */
function resolveLatestOfficialClaude() {
  const override =
    process.env.CLAUDE_CODE_BINARY ||
    process.env.CLAUDE_NATIVE_CLAUDE_PATH ||
    process.env.CLAUDE_OFFICIAL_BINARY
  const paths = []
  if (override) paths.push(override)
  paths.push(path.join(os.homedir(), '.local', 'bin', 'claude.exe'))
  paths.push(path.join(os.homedir(), '.local', 'bin', 'claude'))
  paths.push(...listExtensionClaudeBinaries())

  const seen = new Set()
  const probed = []
  for (const p of paths) {
    const abs = path.isAbsolute(p) ? p : path.resolve(p)
    if (seen.has(abs.toLowerCase())) continue
    seen.add(abs.toLowerCase())
    const hit = probeCandidate(abs)
    if (hit) probed.push(hit)
  }
  if (!probed.length) return null

  probed.sort((a, b) => {
    const c = compareSemver(a.version, b.version)
    if (c !== 0) return -c
    return b.mtime - a.mtime
  })
  return probed[0]
}

/**
 * Prefer latest official binary over an older path offered by the extension.
 * @param {string|null|undefined} offeredPath
 * @returns {{ path: string, version: object, mtime: number, replaced: boolean } | null}
 */
function preferLatestOfficial(offeredPath) {
  const latest = resolveLatestOfficialClaude()
  if (!latest) {
    if (offeredPath && fs.existsSync(offeredPath) && !offeredPath.endsWith('cli.js')) {
      const hit = probeCandidate(offeredPath)
      return hit ? { ...hit, replaced: false } : null
    }
    return null
  }
  if (!offeredPath || !fs.existsSync(offeredPath) || offeredPath.endsWith('cli.js')) {
    return { ...latest, replaced: true }
  }
  const offered = probeCandidate(offeredPath)
  if (!offered) return { ...latest, replaced: true }
  if (compareSemver(latest.version, offered.version) >= 0) {
    const same =
      path.resolve(latest.path).toLowerCase() === path.resolve(offered.path).toLowerCase()
    return { ...latest, replaced: !same }
  }
  return { ...offered, replaced: false }
}

module.exports = {
  parseSemver,
  compareSemver,
  resolveLatestOfficialClaude,
  preferLatestOfficial,
  probeCandidate,
  listExtensionClaudeBinaries,
}
