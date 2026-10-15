#!/usr/bin/env node
/** Install /provider skill that only launches the local provider UI (no keys in chat). */
const fs = require('fs')
const path = require('path')
const os = require('os')

function argValue(name) {
  const i = process.argv.indexOf(name)
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1]
  const hit = process.argv.find((a) => a.startsWith(name + '='))
  if (hit) return hit.slice(name.length + 1)
  return null
}

// Deployed install dir wins (~/.claude/wrapper); fall back to this checkout.
const flagDir = argValue('--wrapper-dir')
const wrapperDir = flagDir ? path.resolve(flagDir) : path.resolve(__dirname)
const wrapperPosix = wrapperDir.replace(/\\/g, '/')
const skillDir = path.join(os.homedir(), '.claude', 'skills', 'provider')
const legacyCmd = path.join(os.homedir(), '.claude', 'commands', 'provider.md')

fs.mkdirSync(skillDir, { recursive: true })

// Template lives next to the wrapper source; after deploy, skills/ is excluded,
// so also accept the template from a sibling checkout.
const candidates = [
  path.join(wrapperDir, 'skills', 'provider', 'SKILL.md'),
  path.join(__dirname, 'skills', 'provider', 'SKILL.md'),
]
const template = candidates.find((p) => {
  try {
    return fs.existsSync(p)
  } catch {
    return false
  }
})
if (!template) throw new Error('SKILL.md template not found (expected skills/provider/SKILL.md)')

let skill = fs.readFileSync(template, 'utf8')
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
