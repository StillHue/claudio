#!/usr/bin/env node
const fs = require('fs')
const path = require('path')

const settingsPath = path.join(process.env.APPDATA, 'Cursor', 'User', 'settings.json')
const exe = path.join(
  'C:',
  'Users',
  'gabdr',
  'claudio',
  'claude-wrapper',
  'claudio-wrapper-native32.exe',
)

function stripJsonc(raw) {
  let out = ''
  let i = 0
  let inStr = false
  let quote = ''
  let esc = false
  while (i < raw.length) {
    const c = raw[i]
    const n = raw[i + 1]
    if (inStr) {
      out += c
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === quote) inStr = false
      i++
      continue
    }
    if (c === '"' || c === "'") {
      inStr = true
      quote = c
      out += c
      i++
      continue
    }
    if (c === '/' && n === '/') {
      while (i < raw.length && raw[i] !== '\n') i++
      continue
    }
    if (c === '/' && n === '*') {
      i += 2
      while (i < raw.length - 1 && !(raw[i] === '*' && raw[i + 1] === '/')) i++
      i += 2
      continue
    }
    out += c
    i++
  }
  return out
}

const raw = fs.readFileSync(settingsPath, 'utf8')
let settings
try {
  settings = JSON.parse(raw)
} catch {
  settings = JSON.parse(stripJsonc(raw))
}

settings['claudeCode.claudeProcessWrapper'] = exe
fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n')
console.log('updated', settings['claudeCode.claudeProcessWrapper'])
