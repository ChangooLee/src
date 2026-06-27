import memoize from 'lodash-es/memoize.js'
import { getAPIProvider } from './providers.js'

export type ModelCapabilityOverride =
  | 'effort'
  | 'max_effort'
  | 'thinking'
  | 'adaptive_thinking'
  | 'interleaved_thinking'

const TIERS = [
  {
    modelEnvVar: 'OPEN_CODE_CLI_DEFAULT_BEST_MODEL',
    capabilitiesEnvVar: 'OPEN_CODE_CLI_DEFAULT_BEST_MODEL_SUPPORTED_CAPABILITIES',
  },
  {
    modelEnvVar: 'OPEN_CODE_CLI_DEFAULT_MODEL',
    capabilitiesEnvVar: 'OPEN_CODE_CLI_DEFAULT_MODEL_SUPPORTED_CAPABILITIES',
  },
  {
    modelEnvVar: 'OPEN_CODE_CLI_DEFAULT_SMALL_FAST_MODEL',
    capabilitiesEnvVar: 'OPEN_CODE_CLI_DEFAULT_SMALL_FAST_MODEL_SUPPORTED_CAPABILITIES',
  },
] as const

/**
 * Check whether a 3p model capability override is set for a model that matches one of
 * the pinned OPEN_CODE_CLI_DEFAULT_*_MODEL env vars.
 */
export const get3PModelCapabilityOverride = memoize(
  (model: string, capability: ModelCapabilityOverride): boolean | undefined => {
    if (false) {
      return undefined
    }
    const m = model.toLowerCase()
    for (const tier of TIERS) {
      const pinned = process.env[tier.modelEnvVar]
      const capabilities = process.env[tier.capabilitiesEnvVar]
      if (!pinned || capabilities === undefined) continue
      if (m !== pinned.toLowerCase()) continue
      return capabilities
        .toLowerCase()
        .split(',')
        .map(s => s.trim())
        .includes(capability)
    }
    return undefined
  },
  (model, capability) => `${model.toLowerCase()}:${capability}`,
)
