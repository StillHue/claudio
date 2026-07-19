import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, test } from 'bun:test'
import { clearCommandMemoizationCaches, getCommands } from '../commands.js'

const FORBIDDEN = [
  'ads',
  'buddy',
  'stickers',
  'upgrade',
  'passes',
  'extra-usage',
  'mobile',
  'install-slack-app',
  'think-back',
  'thinkback-play',
] as const

describe('no OpenClaude cruft commands', () => {
  test('built-in command names exclude promotional commands', async () => {
    clearCommandMemoizationCaches()
    const cwd = await mkdtemp(join(tmpdir(), 'oc-no-cruft-'))
    try {
      const cmds = await getCommands(cwd)
      const names = cmds.map(c => c.name)
      for (const name of FORBIDDEN) {
        expect(names).not.toContain(name)
      }
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  test('tip modules do not reference ads.gitlawb.com', async () => {
    const adsPath = new URL('../services/ads.ts', import.meta.url)
    const exists = await Bun.file(adsPath).exists()
    expect(exists).toBe(false)
  })
})
