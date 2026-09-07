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
  AUTO_PICKER_ID,
  isAutoPickerId,
} = require('./lib/provider/resolve')
const {
  syncClaudeAvailableModels,
  syncCursorClaudeModel,
  syncIdeClaudeModel,
  syncDefaultModel,
  persistProvidersDefault,
  setDefaultModel,
  cursorUserSettingsPaths,
  ideHostSettingsTargets,
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
  buildAnthropicModelsList,
  resolveApiKey,
  buildSlugIndex,
  AUTO_PICKER_ID,
  isAutoPickerId,
  syncClaudeAvailableModels,
  syncCursorClaudeModel,
  syncIdeClaudeModel,
  syncDefaultModel,
  persistProvidersDefault,
  setDefaultModel,
  cursorUserSettingsPaths,
  ideHostSettingsTargets,
}
