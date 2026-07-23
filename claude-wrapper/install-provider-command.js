#!/usr/bin/env node
/** Install /provider skill + command as UTF-8 without BOM (PS Set-Content UTF8 adds BOM and breaks YAML). */
const fs = require('fs')
const path = require('path')
const os = require('os')

const wrapperDir = path.resolve(__dirname)
const wrapperPosix = wrapperDir.replace(/\\/g, '/')
const skillDir = path.join(os.homedir(), '.claude', 'skills', 'provider')
const cmdDir = path.join(os.homedir(), '.claude', 'commands')

fs.mkdirSync(skillDir, { recursive: true })
fs.mkdirSync(cmdDir, { recursive: true })

let skill = fs.readFileSync(path.join(wrapperDir, 'skills', 'provider', 'SKILL.md'), 'utf8')
skill = skill.replace(/^\uFEFF/, '').split('{{WRAPPER_DIR}}').join(wrapperPosix)
fs.writeFileSync(path.join(skillDir, 'SKILL.md'), skill, 'utf8')

const cmd = `---
description: List providers, connect API key, sync models for /model
disable-model-invocation: true
allowed-tools: Bash, Read
argument-hint: "[provider-id]"
---

Follow the provider skill at ~/.claude/skills/provider/SKILL.md exactly.
Wrapper: ${wrapperPosix}
Arguments: $ARGUMENTS
`
fs.writeFileSync(path.join(cmdDir, 'provider.md'), cmd, 'utf8')

function hasBom(p) {
  const b = fs.readFileSync(p)
  return b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf
}

console.log('Installed (UTF-8 no BOM):')
console.log(' ', path.join(skillDir, 'SKILL.md'), 'bom=' + hasBom(path.join(skillDir, 'SKILL.md')))
console.log(' ', path.join(cmdDir, 'provider.md'), 'bom=' + hasBom(path.join(cmdDir, 'provider.md')))
console.log('')
console.log('Fully quit Claude Code / Agents Window, reopen, then type /provider')
console.log('If the model is 401ing, slash cannot reply — fix bridge first or run:')
console.log('  node "' + path.join(wrapperDir, 'enable-provider.js') + '"')
