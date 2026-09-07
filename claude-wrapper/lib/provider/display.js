/**
 * Display names, legacy slugs, and provider tags for the Claude native catalog.
 */
const DISPLAY = {
  // OpenCode Zen → short Sonnet labels (no "Claude"/"Free"; upstream unchanged).
  // Ranking by agentic/day-to-day fit: MiMo = Sonnet 5, DeepSeek Flash = 4.8.
  'auto': {
    name: 'Auto',
    description: 'Auto-routes dynamically between Fast & Frontier models based on prompt complexity',
    slug: 'auto',
  },
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
  // OpenRouter — roteamento inteligente via BYOK providers.
  'openrouter/auto': {
    name: 'Auto (OpenRouter)',
    description: 'OpenRouter → auto-router classifica e roteia entre modelos',
    slug: 'auto',
  },
  'openrouter/auto-beta': {
    name: 'Auto Beta',
    description: 'OpenRouter → auto-beta early access',
    slug: 'auto-beta',
  },
  // NVIDIA NIM Models
  'nvidia/nemotron-3-ultra-550b-a55b': {
    name: 'Nemotron 3 Ultra 550B',
    description: 'Nvidia → Flagship 550B frontier model',
    slug: 'nemotron-ultra-550b',
  },
  'nvidia/nemotron-3-super-120b-a12b': {
    name: 'Nemotron 3 Super 120B',
    description: 'Nvidia → Fast high-throughput 120B model',
    slug: 'nemotron-super-120b',
  },
  'nvidia/nemotron-3.5-lightning-30b-a3b': {
    name: 'Nemotron 3.5 Lightning 30B',
    description: 'Nvidia → Ultra-fast sub-second latency model',
    slug: 'nemotron-lightning-30b',
  },
  'nvidia/nemotron-3-nano-30b-a3b': {
    name: 'Nemotron 3 Nano 30B',
    description: 'Nvidia → Lightweight efficient 30B model',
    slug: 'nemotron-nano-30b',
  },
  'nvidia/nemotron-nano-12b-v2-vl': {
    name: 'Nemotron Nano 12B VL (EOL)',
    description: 'Nvidia → retired 2026-08-26',
    slug: 'nemotron-nano-12b-vl',
  },
  'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning': {
    name: 'Nemotron 3 Nano Omni 30B',
    description: 'Nvidia → Multimodal vision + reasoning',
    slug: 'nemotron-nano-omni-30b',
  },
  'meta/llama-3.3-70b-instruct': {
    name: 'Llama 3.3 70B Instruct',
    description: 'Nvidia → Meta Llama 3.3 70B flagship',
    slug: 'llama-3-3-70b',
  },
  'deepseek-ai/deepseek-r1': {
    name: 'DeepSeek R1',
    description: 'Nvidia → Reasoning reasoning model',
    slug: 'deepseek-r1',
  },
  'deepseek-ai/deepseek-v3': {
    name: 'DeepSeek V3',
    description: 'Nvidia → DeepSeek V3 671B MoE',
    slug: 'deepseek-v3',
  },
  'qwen/qwen2.5-coder-32b-instruct': {
    name: 'Qwen 2.5 Coder 32B',
    description: 'Nvidia → Specialized code generation model',
    slug: 'qwen-2-5-coder-32b',
  },
  'mistralai/mistral-large-2-instruct': {
    name: 'Mistral Large 2',
    description: 'Nvidia → Mistral flagship 123B model',
    slug: 'mistral-large-2',
  },
  'mistralai/codestral-2501': {
    name: 'Codestral 2501',
    description: 'Nvidia → Mistral specialized coding model',
    slug: 'codestral-2501',
  },
}

/** Picker / legacy ids → upstream Zen free (or Cohere) model */
const LEGACY_SLUGS = {
  auto: 'auto',
  'claude-auto': 'auto',
  'anthropic.auto': 'auto',
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
  mistral: 'Mistral',
  nvidia: 'Nvidia',
  openrouter: 'OpenRouter',
}

/** Short tag embedded in picker ids: anthropic.<tag>.<model> */
const PROVIDER_TAG = {
  opencode: 'opencode',
  openrouter: 'openrouter',
  nvidia: 'nvidia',
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
