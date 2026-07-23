#!/usr/bin/env node
/** Install /provider skill as UTF-8 without BOM. One entry only (no ~/.claude/commands duplicate). */
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

// Skill wins over commands/; keep only one /provider in the menu.
if (fs.existsSync(legacyCmd)) {
  fs.unlinkSync(legacyCmd)
  console.log('Removed duplicate', legacyCmd)
}

function hasBom(p) {
  const b = fs.readFileSync(p)
  return b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf
}

const skillPath = path.join(skillDir, 'SKILL.md')
console.log('Installed (UTF-8 no BOM):')
console.log(' ', skillPath, 'bom=' + hasBom(skillPath))
console.log('')
console.log('Restart Claude Code, then /provider (one entry).')
console.log('Terminal: node "' + path.join(wrapperDir, 'enable-provider.js') + '"')
