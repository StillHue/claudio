/**
 * Display names, legacy slugs, and provider tags for the Claude native catalog.
 */
const DISPLAY = {
  // OpenCode Zen → short Sonnet labels (no "Claude"/"Free"; upstream unchanged).
  // Ranking by agentic/day-to-day fit: MiMo = Sonnet 5, DeepSeek Flash = 4.8.
  'muse-spark-1.2-contributor-free': {
    name: 'Muse Spark 1.2',
    description: 'OpenCode Zen → muse-spark-1.2-contributor-free (responses)',
    slug: 'muse-spark-1-2',
  },
  'mimo-v2.5-free': {
    name: 'Sonnet 5',
    description: 'OpenCode Zen → mimo-v2.5-free',
    slug: 'claude-sonnet-5',
  },
  'big-pickle': {
    name: 'Sonnet 5 Max',
    description: 'OpenCode Zen → big-pickle',
    slug: 'claude-sonnet-5-max',
  },
  'deepseek-v4-flash-free': {
    name: 'Sonnet 4.8',
    description: 'OpenCode Zen → deepseek-v4-flash-free',
    slug: 'claude-sonnet-4-8',
  },
  'north-mini-code-free': {
    name: 'Sonnet 4.5',
    description: 'OpenCode Zen → north-mini-code-free',
    slug: 'claude-sonnet-4-5',
  },
  'laguna-s-2.1-free': {
    name: 'Sonnet 4.5 Fast',
    description: 'OpenCode Zen → laguna-s-2.1-free',
    slug: 'claude-sonnet-4-5-fast',
  },
  'nemotron-3-ultra-free': {
    name: 'Sonnet 4.7',
    description: 'OpenCode Zen → nemotron-3-ultra-free',
    slug: 'claude-sonnet-4-7',
  },
  'hy3-free': {
    name: 'Hy3',
    description: 'OpenCode Zen → hy3-free',
    slug: 'hy3-free',
  },
}

/** Picker / legacy ids → upstream Zen free (or Cohere) model */
const LEGACY_SLUGS = {
  lite: 'deepseek-v4-flash-free',
  fast: 'deepseek-v4-flash-free',
  mini: 'north-mini-code-free',
  spark: 'laguna-s-2.1-free',
  max: 'big-pickle',
  ultra: 'nemotron-3-ultra-free',
  'big-pickle': 'big-pickle',
  mimo: 'mimo-v2.5-free',
  'mimo-v2.5-free': 'mimo-v2.5-free',
  'deepseek-v4': 'deepseek-v4-flash-free',
  'deepseek-v4-flash-free': 'deepseek-v4-flash-free',
  laguna: 'laguna-s-2.1-free',
  'laguna-s-2.1-free': 'laguna-s-2.1-free',
  nemotron: 'nemotron-3-ultra-free',
  'nemotron-3-ultra-free': 'nemotron-3-ultra-free',
  'north-mini-code-free': 'north-mini-code-free',
  'opencode-zen-lite': 'deepseek-v4-flash-free',
  'opencode-zen-fast': 'deepseek-v4-flash-free',
  'opencode-zen-mini': 'north-mini-code-free',
  'opencode-zen-spark': 'laguna-s-2.1-free',
  'opencode-zen-max': 'big-pickle',
  'opencode-zen-ultra': 'nemotron-3-ultra-free',
  // Anthropic-looking picker slugs (current + legacy Free/Opus/Haiku ids)
  'claude-sonnet-5': 'mimo-v2.5-free',
  'claude-sonnet-5-free': 'mimo-v2.5-free',
  'claude-sonnet-5-max': 'big-pickle',
  'claude-sonnet-5.max': 'big-pickle',
  sonnet: 'mimo-v2.5-free',
  'claude-sonnet-4-8': 'deepseek-v4-flash-free',
  'claude-sonnet-4.8': 'deepseek-v4-flash-free',
  // Old "4.8 Max" label still resolves to big-pickle
  'claude-sonnet-4-8-max': 'big-pickle',
  'claude-sonnet-4.8-max': 'big-pickle',
  'claude-sonnet-4-5': 'north-mini-code-free',
  'claude-sonnet-4.5': 'north-mini-code-free',
  'claude-sonnet-4-5-fast': 'laguna-s-2.1-free',
  'claude-sonnet-4.5-fast': 'laguna-s-2.1-free',
  'claude-sonnet-4-7': 'nemotron-3-ultra-free',
  'claude-sonnet-4.7': 'nemotron-3-ultra-free',
  // Legacy Opus / Haiku / Free aliases → same upstream
  'claude-opus-4-8-free': 'deepseek-v4-flash-free',
  'claude-opus-4.8-free': 'deepseek-v4-flash-free',
  'claude-opus-4-8': 'big-pickle',
  'claude-opus-4.8': 'big-pickle',
  'claude-haiku-4-5-free': 'north-mini-code-free',
  'claude-haiku-4.5-free': 'north-mini-code-free',
  'claude-haiku-4-5-free-2': 'laguna-s-2.1-free',
  'claude-haiku-4.5-free-2': 'laguna-s-2.1-free',
  'claude-opus-4-7-free': 'nemotron-3-ultra-free',
  'claude-opus-4.7-free': 'nemotron-3-ultra-free',
  'claude-opus-4-7': 'nemotron-3-ultra-free',
  'claude-opus-4.7': 'nemotron-3-ultra-free',
  opus: 'nemotron-3-ultra-free',
  'claude-fable-5': 'nemotron-3-ultra-free',
  fable: 'nemotron-3-ultra-free',
}

const PROVIDER_LABEL = {
  opencode: 'OpenCode Zen',
}

/** Short tag embedded in picker ids: anthropic.<tag>.<model> */
const PROVIDER_TAG = {
  opencode: 'opencode',
}

function providerTag(providerName) {
  if (PROVIDER_TAG[providerName]) return PROVIDER_TAG[providerName]
  return String(providerName || 'provider').replace(/[^a-zA-Z0-9._-]/g, '-')
}

function modelSlug(model) {
  return (
    DISPLAY[model]?.slug ||
    String(model || 'model').replace(/[^a-zA-Z0-9._-]/g, '-')
  )
}

module.exports = {
  DISPLAY,
  LEGACY_SLUGS,
  PROVIDER_LABEL,
  PROVIDER_TAG,
  providerTag,
  modelSlug,
}
