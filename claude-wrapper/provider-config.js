/**
 * Shared provider config for the native bridge.
 * Callers that need one symbol import lib/provider directly.
 */
const {
  loadProvidersConfig,
  resolveProvider,
  buildAnthropicModelsList,
} = require('./lib/provider/resolve')
const { syncDefaultModel } = require('./lib/provider/sync')

module.exports = {
  loadProvidersConfig,
  resolveProvider,
  buildAnthropicModelsList,
  syncDefaultModel,
}
