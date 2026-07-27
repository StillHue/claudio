/**
 * Shared provider + model catalog for Claude native mode.
 * Thin re-export — implementation lives under lib/provider/.
 */
const {
  DISPLAY,
  LEGACY_SLUGS,
  PROVIDER_LABEL,
  PROVIDER_TAG,
  providerTag,
  modelSlug,
} = require('./lib/provider/display')
const {
  loadProvidersConfig,
  listCatalogEntries,
  modelId,
  parseModelId,
  resolveProvider,
  buildAnthropicModelsList,
  resolveApiKey,
  buildSlugIndex,
} = require('./lib/provider/resolve')
const {
  syncClaudeAvailableModels,
  syncCursorClaudeModel,
  syncDefaultModel,
  persistProvidersDefault,
  setDefaultModel,
  cursorUserSettingsPaths,
} = require('./lib/provider/sync')

module.exports = {
  DISPLAY,
  LEGACY_SLUGS,
  PROVIDER_LABEL,
  PROVIDER_TAG,
  providerTag,
  modelSlug,
  loadProvidersConfig,
  listCatalogEntries,
  modelId,
  parseModelId,
  resolveProvider,
  resolveApiKey,
  buildSlugIndex,
  buildAnthropicModelsList,
  syncClaudeAvailableModels,
  syncCursorClaudeModel,
  syncDefaultModel,
  persistProvidersDefault,
  setDefaultModel,
  cursorUserSettingsPaths,
}
