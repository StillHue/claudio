#!/usr/bin/env node
/**
 * Remove chat-based /provider skill (API keys in transcript = bad).
 * Provider setup UI is the terminal wizard: enable-provider.js
 */
const fs = require('fs')
const path = require('path')
const os = require('os')

const skillDir = path.join(os.homedir(), '.claude', 'skills', 'provider')
const skillFile = path.join(skillDir, 'SKILL.md')
const legacyCmd = path.join(os.homedir(), '.claude', 'commands', 'provider.md')

function rm(p) {
  try {
    if (fs.existsSync(p)) {
      fs.rmSync(p, { recursive: true, force: true })
      console.log('removed', p)
      return true
    }
  } catch (err) {
    console.error('failed', p, err.message)
  }
  return false
}

rm(skillFile)
rm(skillDir)
rm(legacyCmd)

const wrapper = path.resolve(__dirname)
console.log('')
console.log('Use the terminal UI (key is hidden, not stored in chat):')
console.log('  node "' + path.join(wrapper, 'enable-provider.js') + '"')
console.log('or:')
console.log('  "' + path.join(wrapper, 'enable-provider.cmd') + '"')
