/** Picker id pieces: anthropic.<provider>.<model-slug>. Label matches Claude Code's Sonnet 5.5. */
const PICKER_LABEL = 'Sonnet 5.5'
const PICKER_DESCRIPTION = 'Most efficient for simpler tasks'

function providerTag(providerName) {
  return String(providerName || 'provider').replace(/[^a-zA-Z0-9._-]/g, '-')
}

function modelSlug(model) {
  return String(model || 'model').replace(/[^a-zA-Z0-9._-]/g, '-')
}

module.exports = { providerTag, modelSlug, PICKER_LABEL, PICKER_DESCRIPTION }
