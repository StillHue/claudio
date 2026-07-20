#!/usr/bin/env node
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const fake = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fake-claudio.mjs')
const child = spawn(process.execPath, [fake, ...process.argv.slice(2)], {
  stdio: 'inherit',
  windowsHide: true,
})
child.on('exit', code => process.exit(code ?? 0))
