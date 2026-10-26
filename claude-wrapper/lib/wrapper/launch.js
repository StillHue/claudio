const path = require('path')

function isNodeBinary(filePath) {
  if (!filePath || typeof filePath !== 'string') return false
  const base = path.basename(filePath).toLowerCase()
  return base === 'node' || base === 'node.exe'
}

function isExtensionClaudeLauncher(filePath) {
  if (!filePath || typeof filePath !== 'string' || !path.isAbsolute(filePath)) return false
  const normalized = filePath.replace(/\\/g, '/').toLowerCase()
  if (normalized.endsWith('/cli.js') && normalized.includes('claude')) return true
  if (/claude-code|native-binary/i.test(normalized)) return true
  const base = path.basename(normalized)
  return base === 'claude' || base === 'claude.exe'
}

function stripExtensionLauncher(argv) {
  const args = argv.slice()
  if (args.length === 0) return args
  if (isNodeBinary(args[0]) && args.length >= 2 && isExtensionClaudeLauncher(args[1])) {
    return args.slice(2)
  }
  if (isExtensionClaudeLauncher(args[0])) return args.slice(1)
  return args
}

function parseOfficialLaunch(argv) {
  const args = argv.slice()
  if (args.length === 0) return null
  if (isNodeBinary(args[0]) && args.length >= 2 && isExtensionClaudeLauncher(args[1])) {
    return { command: args[0], args: args.slice(1) }
  }
  if (isExtensionClaudeLauncher(args[0])) return { command: args[0], args: args.slice(1) }
  return null
}

function isJavaScriptEntryPoint(filePath) {
  return /\.(?:c|m)?js$/i.test(filePath || '')
}

function selectLaunchTarget({ fromExt, rawArgs, preferredPath, bundled }) {
  let command = preferredPath || bundled?.command || null
  let userArgs = []

  if (fromExt) {
    if (isNodeBinary(fromExt.command)) {
      userArgs = fromExt.args.slice(1)
      if (!command) {
        const entryPoint = fromExt.args[0]
        if (entryPoint && !isJavaScriptEntryPoint(entryPoint)) {
          command = entryPoint
        } else {
          command = fromExt.command
          userArgs = fromExt.args
        }
      }
    } else {
      userArgs = fromExt.args
      if (!command) command = fromExt.command
    }
  } else {
    userArgs = stripExtensionLauncher(rawArgs)
    if (!command && bundled) command = bundled.command
  }

  return { command, userArgs }
}

module.exports = {
  isNodeBinary,
  isExtensionClaudeLauncher,
  stripExtensionLauncher,
  parseOfficialLaunch,
  selectLaunchTarget,
}
