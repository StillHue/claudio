import { afterAll, describe, expect, mock, test } from 'bun:test'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../../test/sharedMutationLock.js'
import * as actualAnalytics from '../analytics/index.js'
import * as actualConfig from '../../utils/config.js'
import * as actualSettings from '../../utils/settings/settings.js'
import type { Tip } from './types.js'
import * as actualTipRegistry from './tipRegistry.js'

const settingsRef: {
  value: {
    spinnerTipsEnabled?: boolean
  }
} = { value: {} }
const configRef: {
  value: {
    numStartups: number
    tipsHistory?: Record<string, number>
  }
} = { value: { numStartups: 100 } }

const relevantTipsRef: { value: Tip[] } = { value: [] }

await acquireSharedMutationLock('services/tips/tipScheduler.test.ts')

mock.module('../../utils/settings/settings.js', () => ({
  getSettings_DEPRECATED: () => settingsRef.value,
  getInitialSettings: () => settingsRef.value,
  getSettingsForSource: () => undefined,
}))

mock.module('../../utils/config.js', () => ({
  getGlobalConfig: () => configRef.value,
  saveGlobalConfig: (mut: (c: typeof configRef.value) => typeof configRef.value) => {
    configRef.value = mut(configRef.value)
  },
}))

mock.module('./tipRegistry.js', () => ({
  getRelevantTips: async () => relevantTipsRef.value,
}))

mock.module('../analytics/index.js', () => ({
  logEvent: () => undefined,
}))

afterAll(() => {
  try {
    mock.restore()
    mock.module('../../utils/settings/settings.js', () => actualSettings)
    mock.module('../../utils/config.js', () => actualConfig)
    mock.module('./tipRegistry.js', () => actualTipRegistry)
    mock.module('../analytics/index.js', () => actualAnalytics)
  } finally {
    releaseSharedMutationLock()
  }
})

async function freshScheduler() {
  const stamp = `${Date.now()}-${Math.random()}`
  return import(`./tipScheduler.ts?ts=${stamp}`)
}

function makeTip(id: string): Tip {
  return {
    id,
    content: async () => id,
    cooldownSessions: 0,
    isRelevant: async () => true,
  }
}

function setState(opts: {
  numStartups?: number
  tipsHistory?: Record<string, number>
  tips: Tip[]
}) {
  configRef.value = {
    numStartups: opts.numStartups ?? 100,
    ...(opts.tipsHistory ? { tipsHistory: opts.tipsHistory } : {}),
  }
  settingsRef.value = {}
  relevantTipsRef.value = opts.tips
}

describe('getTipToShowOnSpinner — regular tips only', () => {
  test('picks a regular tip when available', async () => {
    setState({ tips: [makeTip('regular-1'), makeTip('regular-2')] })
    const { getTipToShowOnSpinner } = await freshScheduler()
    const pick = await getTipToShowOnSpinner()
    expect(pick?.id).toBe('regular-1')
  })

  test('excludes sponsored tips from selection', async () => {
    setState({
      tips: [
        makeTip('regular-1'),
        {
          ...makeTip('sponsored-1'),
          sponsor: { name: 'Partner', url: 'https://example.com/' },
        },
      ],
    })
    const { getTipToShowOnSpinner } = await freshScheduler()
    const pick = await getTipToShowOnSpinner()
    expect(pick?.id).toBe('regular-1')
  })

  test('returns undefined when no regular tips remain', async () => {
    setState({
      tips: [
        {
          ...makeTip('sponsored-only'),
          sponsor: { name: 'Partner', url: 'https://example.com/' },
        },
      ],
    })
    const { getTipToShowOnSpinner } = await freshScheduler()
    expect(await getTipToShowOnSpinner()).toBeUndefined()
  })

  test('returns undefined when no tips at all', async () => {
    setState({ tips: [] })
    const { getTipToShowOnSpinner } = await freshScheduler()
    expect(await getTipToShowOnSpinner()).toBeUndefined()
  })

  test('spinnerTipsEnabled=false short-circuits everything', async () => {
    setState({ tips: [makeTip('regular-1')] })
    settingsRef.value = { spinnerTipsEnabled: false }
    const { getTipToShowOnSpinner } = await freshScheduler()
    expect(await getTipToShowOnSpinner()).toBeUndefined()
  })

  test('prefers the tip shown longest ago', async () => {
    setState({
      numStartups: 100,
      tipsHistory: { 'regular-old': 10, 'regular-new': 95 },
      tips: [makeTip('regular-old'), makeTip('regular-new')],
    })
    const { getTipToShowOnSpinner } = await freshScheduler()
    const pick = await getTipToShowOnSpinner()
    expect(pick?.id).toBe('regular-old')
  })
})

describe('recordShownTip', () => {
  test('records tip history', async () => {
    setState({ numStartups: 100, tips: [] })
    const { recordShownTip } = await freshScheduler()
    recordShownTip(makeTip('regular-1'))
    expect(configRef.value.tipsHistory).toEqual({ 'regular-1': 100 })
  })
})
