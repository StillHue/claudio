/**
 * Display names, legacy slugs, and provider tags for the Claude native catalog.
 */
const DISPLAY = {
  // OpenCode Zen → short Sonnet labels (no "Claude"/"Free"; upstream unchanged).
  // Ranking by agentic/day-to-day fit: MiMo = Sonnet 5, DeepSeek Flash = 4.8.
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
  'north-mini-code-1-0': {
    name: 'Cohere · north-mini-code',
    description: 'Cohere',
    slug: 'north-mini-code-1-0',
  },
  'command-a-03-2025': {
    name: 'Cohere · command-a',
    description: 'Cohere',
    slug: 'command-a-03-2025',
  },
  'command-r-plus-08-2024': {
    name: 'Cohere · command-r-plus',
    description: 'Cohere',
    slug: 'command-r-plus-08-2024',
  },
  // Mistral models
  'labs-devstral-small-2512': {
    name: 'Labs Devstral Small',
    description: 'Mistral Labs → labs-devstral-small-2512 (free, coding)',
    slug: 'labs-devstral-small-2512',
  },
  'devstral-small-2507': {
    name: 'Devstral Small 2507',
    description: 'Mistral → devstral-small-2507 (coding)',
    slug: 'devstral-small-2507',
  },
  'devstral-small-2505': {
    name: 'Devstral Small 2505',
    description: 'Mistral → devstral-small-2505 (coding)',
    slug: 'devstral-small-2505',
  },
  'devstral-medium-2507': {
    name: 'Devstral Medium 2507',
    description: 'Mistral → devstral-medium-2507 (coding)',
    slug: 'devstral-medium-2507',
  },
  'devstral-medium-latest': {
    name: 'Devstral Medium Latest',
    description: 'Mistral → devstral-medium-latest (coding)',
    slug: 'devstral-medium-latest',
  },
  'devstral-2512': {
    name: 'Devstral 2512',
    description: 'Mistral → devstral-2512 (coding)',
    slug: 'devstral-2512',
  },
  'devstral-latest': {
    name: 'Devstral Latest',
    description: 'Mistral → devstral-latest (coding)',
    slug: 'devstral-latest',
  },
  'codestral-latest': {
    name: 'Codestral Latest',
    description: 'Mistral → codestral-latest (code completion)',
    slug: 'codestral-latest',
  },
  'mistral-large-latest': {
    name: 'Mistral Large Latest',
    description: 'Mistral → mistral-large-latest (flagship)',
    slug: 'mistral-large-latest',
  },
  'mistral-large-2512': {
    name: 'Mistral Large 2512',
    description: 'Mistral → mistral-large-2512 (flagship)',
    slug: 'mistral-large-2512',
  },
  'mistral-large-2411': {
    name: 'Mistral Large 2411',
    description: 'Mistral → mistral-large-2411 (flagship)',
    slug: 'mistral-large-2411',
  },
  'mistral-medium-latest': {
    name: 'Mistral Medium 3.5',
    description: 'Mistral → mistral-medium-latest (balanced)',
    slug: 'mistral-medium-latest',
  },
  'mistral-medium-2604': {
    name: 'Mistral Medium 2604',
    description: 'Mistral → mistral-medium-2604',
    slug: 'mistral-medium-2604',
  },
  'mistral-medium-2508': {
    name: 'Mistral Medium 2508',
    description: 'Mistral → mistral-medium-2508',
    slug: 'mistral-medium-2508',
  },
  'mistral-medium-2505': {
    name: 'Mistral Medium 2505',
    description: 'Mistral → mistral-medium-2505',
    slug: 'mistral-medium-2505',
  },
  'mistral-small-latest': {
    name: 'Mistral Small Latest',
    description: 'Mistral → mistral-small-latest (fast)',
    slug: 'mistral-small-latest',
  },
  'mistral-small-2603': {
    name: 'Mistral Small 2603',
    description: 'Mistral → mistral-small-2603 (fast, coding)',
    slug: 'mistral-small-2603',
  },
  'mistral-small-2506': {
    name: 'Mistral Small 2506',
    description: 'Mistral → mistral-small-2506 (fast)',
    slug: 'mistral-small-2506',
  },
  'mistral-nemo': {
    name: 'Mistral Nemo',
    description: 'Mistral → mistral-nemo (12B, multilingual)',
    slug: 'mistral-nemo',
  },
  'magistral-medium-latest': {
    name: 'Magistral Medium Latest',
    description: 'Mistral → magistral-medium-latest (reasoning)',
    slug: 'magistral-medium-latest',
  },
  'magistral-small': {
    name: 'Magistral Small',
    description: 'Mistral → magistral-small (reasoning)',
    slug: 'magistral-small',
  },
  'ministral-3b-latest': {
    name: 'Ministral 3B Latest',
    description: 'Mistral → ministral-3b-latest (edge)',
    slug: 'ministral-3b-latest',
  },
  'ministral-8b-latest': {
    name: 'Ministral 8B Latest',
    description: 'Mistral → ministral-8b-latest (edge)',
    slug: 'ministral-8b-latest',
  },
  'mistral-embed': {
    name: 'Mistral Embed',
    description: 'Mistral → mistral-embed (embeddings)',
    slug: 'mistral-embed',
  },
  'open-mistral-7b': {
    name: 'Open Mistral 7B',
    description: 'Mistral → open-mistral-7b (open weights)',
    slug: 'open-mistral-7b',
  },
  'open-mistral-nemo': {
    name: 'Open Mistral Nemo',
    description: 'Mistral → open-mistral-nemo (open weights)',
    slug: 'open-mistral-nemo',
  },
  'open-mixtral-8x22b': {
    name: 'Open Mixtral 8x22B',
    description: 'Mistral → open-mixtral-8x22b (open weights, MoE)',
    slug: 'open-mixtral-8x22b',
  },
  'open-mixtral-8x7b': {
    name: 'Open Mixtral 8x7B',
    description: 'Mistral → open-mixtral-8x7b (open weights, MoE)',
    slug: 'open-mixtral-8x7b',
  },
  'pixtral-12b': {
    name: 'Pixtral 12B',
    description: 'Mistral → pixtral-12b (vision)',
    slug: 'pixtral-12b',
  },
  'pixtral-large-latest': {
    name: 'Pixtral Large Latest',
    description: 'Mistral → pixtral-large-latest (vision, flagship)',
    slug: 'pixtral-large-latest',
  },
  // Cohere models
  'command-a-plus-05-2026': {
    name: 'Command A Plus',
    description: 'Cohere → command-a-plus (flagship, coding + general)',
    slug: 'command-a-plus-05-2026',
  },
  'command-a-03-2025': {
    name: 'Command A',
    description: 'Cohere → command-a (general)',
    slug: 'command-a-03-2025',
  },
  'command-a-reasoning-08-2025': {
    name: 'Command A Reasoning',
    description: 'Cohere → command-a-reasoning (deep reasoning)',
    slug: 'command-a-reasoning-08-2025',
  },
  'command-a-vision-07-2025': {
    name: 'Command A Vision',
    description: 'Cohere → command-a-vision (vision)',
    slug: 'command-a-vision-07-2025',
  },
  'command-r-plus-08-2024': {
    name: 'Command R+',
    description: 'Cohere → command-r-plus (RAG + coding)',
    slug: 'command-r-plus-08-2024',
  },
  'command-r7b-12-2024': {
    name: 'Command R7B',
    description: 'Cohere → command-r7b (lightweight)',
    slug: 'command-r7b-12-2024',
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
  cohere: 'Cohere',
  alibaba: 'Alibaba',
  'alibaba-cn': 'Alibaba CN',
  'alibaba-coding-plan': 'Alibaba Coding',
  'alibaba-coding-plan-cn': 'Alibaba Coding CN',
  'alibaba-token-plan': 'Alibaba Token',
  'alibaba-token-plan-cn': 'Alibaba Token CN',
  mistral: 'Mistral',
}

/** Short tag embedded in picker ids: anthropic.<tag>.<model> */
const PROVIDER_TAG = {
  opencode: 'opencode',
  cohere: 'cohere',
  alibaba: 'alibaba',
  'alibaba-cn': 'alibaba-cn',
  'alibaba-coding-plan': 'alibaba-coding',
  'alibaba-coding-plan-cn': 'alibaba-coding-cn',
  'alibaba-token-plan': 'alibaba-token',
  'alibaba-token-plan-cn': 'alibaba-token-cn',
  mistral: 'mistral',
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
