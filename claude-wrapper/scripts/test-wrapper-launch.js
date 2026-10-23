const assert = require('assert')
const { parseOfficialLaunch, selectLaunchTarget } = require('../lib/wrapper/launch')

const nativeBinary = '/Applications/Claude/resources/native-binary/claude'
const nodeCommand = '/usr/local/bin/node'
const nativeArgs = [nodeCommand, nativeBinary, '--version']
const parsedNative = parseOfficialLaunch(nativeArgs)

assert.deepStrictEqual(
  selectLaunchTarget({ fromExt: parsedNative, rawArgs: nativeArgs }),
  { command: nativeBinary, userArgs: ['--version'] },
  'native binaries must not be passed to Node as JavaScript',
)

const scriptPath = '/usr/local/lib/node_modules/@anthropic-ai/claude-code/cli.js'
const scriptArgs = [nodeCommand, scriptPath, '--version']
assert.deepStrictEqual(
  selectLaunchTarget({
    fromExt: parseOfficialLaunch(scriptArgs),
    rawArgs: scriptArgs,
  }),
  { command: nodeCommand, userArgs: [scriptPath, '--version'] },
  'JavaScript CLI entry points must continue to run through Node',
)

assert.deepStrictEqual(
  selectLaunchTarget({
    fromExt: parsedNative,
    rawArgs: nativeArgs,
    preferredPath: '/resolved/official/claude',
  }),
  { command: '/resolved/official/claude', userArgs: ['--version'] },
  'a resolved official binary must remain preferred',
)

console.log('wrapper launch selection: OK')
