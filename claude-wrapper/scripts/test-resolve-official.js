/** Resolver coverage: server roots, npm global, cli.js probing. Offline. */
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const resolve = require('../resolve-official-claude')

function mkfile(p, content) {
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, content === undefined ? '' : content)
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claudio-resolve-'))
  // Fake HOME with stale desktop bundle + fresh server bundle.
  const home = path.join(tmp, 'home')
  const officialShim = path.join(home, '.local', 'bin', 'claude-official')
  mkfile(officialShim, '#!/bin/sh\necho "2.1.308 (Claude Code)"\n')
  fs.chmodSync(officialShim, 0o755)
  mkfile(path.join(home, '.vscode', 'extensions', 'anthropic.claude-code-2.1.278-win32-x64', 'resources', 'native-binary', 'claude.exe'))
  const serverBin = path.join(home, '.vscode-server', 'extensions', 'anthropic.claude-code-2.1.281-win32-x64', 'resources', 'native-binaries', 'linux-x64', 'claude')
  mkfile(serverBin)
  const found = resolve.listExtensionClaudeBinaries(home)
  assert(found.includes(serverBin), 'server root bundle must be listed')
  assert.strictEqual(found.length, 2, 'both bundles listed, dedup left to resolver')

  // Fake npm global root with cli.js reporting a version.
  const npmRoot = path.join(tmp, 'node_modules')
  const cliJs = path.join(npmRoot, '@anthropic-ai', 'claude-code', 'cli.js')
  mkfile(cliJs, "console.log('2.1.281 (Claude Code)')\n")
  const originalHome = process.env.HOME
  process.env.HOME = home
  process.env.CLAUDIO_NPM_ROOT_G = npmRoot
  try {
    const npmFound = resolve.listNpmClaudeBinaries()
    assert(npmFound.includes(cliJs), 'npm cli.js must be listed')
    assert(npmFound.includes(officialShim), 'preserved official launcher must be listed')
    const v = resolve.probeCandidate(cliJs)
    assert(v && v.version.raw === '2.1.281', `cli.js probed via node, got ${v && v.version.raw}`)
  } finally {
    if (originalHome === undefined) delete process.env.HOME
    else process.env.HOME = originalHome
    delete process.env.CLAUDIO_NPM_ROOT_G
  }

  fs.rmSync(tmp, { recursive: true, force: true })
  console.log('resolve official: OK')
}

main().catch((e) => {
  console.error('FAIL:', e.message)
  process.exit(1)
})
