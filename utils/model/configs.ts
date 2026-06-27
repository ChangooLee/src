import type { ModelName } from './model.js'
import type { APIProvider } from './providers.js'

export type ModelConfig = Record<APIProvider, ModelName>

export const GPT_4O_MINI_CONFIG = {
  openaiCompatible: 'openai/gpt-4o-mini',
} as const satisfies ModelConfig

export const GPT_4O_CONFIG = {
  openaiCompatible: 'openai/gpt-4o',
} as const satisfies ModelConfig

export const GPT_4_1_CONFIG = {
  openaiCompatible: 'openai/gpt-4.1',
} as const satisfies ModelConfig

export const GPT_4_1_MINI_CONFIG = {
  openaiCompatible: 'openai/gpt-4.1-mini',
} as const satisfies ModelConfig

export const ALL_MODEL_CONFIGS = {
  haiku35: GPT_4O_MINI_CONFIG,
  haiku45: GPT_4O_MINI_CONFIG,
  sonnet35: GPT_4_1_MINI_CONFIG,
  sonnet37: GPT_4_1_MINI_CONFIG,
  sonnet40: GPT_4O_CONFIG,
  sonnet45: GPT_4O_CONFIG,
  sonnet46: GPT_4O_CONFIG,
  opus40: GPT_4_1_CONFIG,
  opus41: GPT_4_1_CONFIG,
  opus45: GPT_4_1_CONFIG,
  opus46: GPT_4_1_CONFIG,
} as const satisfies Record<string, ModelConfig>

export type ModelKey = keyof typeof ALL_MODEL_CONFIGS
export type CanonicalModelId =
  (typeof ALL_MODEL_CONFIGS)[ModelKey]['openaiCompatible']

export const CANONICAL_MODEL_IDS = Object.values(ALL_MODEL_CONFIGS).map(
  c => c.openaiCompatible,
) as [CanonicalModelId, ...CanonicalModelId[]]

export const CANONICAL_ID_TO_KEY: Record<CanonicalModelId, ModelKey> =
  Object.fromEntries(
    (Object.entries(ALL_MODEL_CONFIGS) as [ModelKey, ModelConfig][]).map(
      ([key, cfg]) => [cfg.openaiCompatible, key],
    ),
  ) as Record<CanonicalModelId, ModelKey>
