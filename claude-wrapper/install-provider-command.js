#!/usr/bin/env node
/** Install /provider skill that only launches the local provider UI (no keys in chat). */
const fs = require('fs')
const path = require('path')
const os = require('os')

const wrapperDir = path.resolve(__dirname)
const wrapperPosix = wrapperDir.replace(/\\/g, '/')
const skillDir = path.join(os.homedir(), '.claude', 'skills', 'provider')
const legacyCmd = path.join(os.homedir(), '.claude', 'commands', 'provider.md')

fs.mkdirSync(skillDir, { recursive: true })

let skill = fs.readFileSync(path.join(wrapperDir, 'skills', 'provider', 'SKILL.md'), 'utf8')
skill = skill.replace(/^\uFEFF/, '').split('{{WRAPPER_DIR}}').join(wrapperPosix)
fs.writeFileSync(path.join(skillDir, 'SKILL.md'), skill, 'utf8')

if (fs.existsSync(legacyCmd)) {
  fs.unlinkSync(legacyCmd)
  console.log('Removed duplicate', legacyCmd)
}

console.log('Installed /provider → launches local UI (127.0.0.1), key never in chat')
console.log(' ', path.join(skillDir, 'SKILL.md'))
console.log('Restart Claude Code, then /provider')
console.log('Manual: node "' + path.join(wrapperDir, 'provider-ui.js') + '"')
