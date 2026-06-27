import memoize from 'lodash-es/memoize.js'

const UNSUPPORTED_PROVIDER_MESSAGE =
  'AWS Bedrock is not supported in this OpenAI-compatible provider build. Configure OPEN_CODE_CLI_API_KEY and an OpenAI-compatible endpoint such as OpenRouter instead.'

function unsupportedProvider(): never {
  throw new Error(UNSUPPORTED_PROVIDER_MESSAGE)
}

export const getOpenAICompatibleInferenceProfiles = memoize(async function (): Promise<
  string[]
> {
  unsupportedProvider()
})

export function findFirstMatch(
  profiles: string[],
  substring: string,
): string | null {
  return profiles.find(p => p.includes(substring)) ?? null
}

export async function createOpenAICompatibleRuntimeClient(): Promise<never> {
  unsupportedProvider()
}

export const getInferenceProfileBackingModel = memoize(async function (
  _profileId: string,
): Promise<string | null> {
  unsupportedProvider()
})

/**
 * Check if a model ID uses the legacy AWS-hosted foundation model shape.
 */
export function isFoundationModel(modelId: string): boolean {
  return modelId.startsWith('openai-compatible.')
}

const BEDROCK_REGION_PREFIXES = ['us', 'eu', 'apac', 'global'] as const

/**
 * Extract the model/inference profile ID from a legacy ARN-like model ID.
 * If the input is not an ARN, returns it unchanged.
 */
export function extractModelIdFromArn(modelId: string): string {
  if (!modelId.startsWith('arn:')) {
    return modelId
  }
  const lastSlashIndex = modelId.lastIndexOf('/')
  if (lastSlashIndex === -1) {
    return modelId
  }
  return modelId.substring(lastSlashIndex + 1)
}

export type OpenAICompatibleRegionPrefix =
  (typeof BEDROCK_REGION_PREFIXES)[number]

/**
 * Extract a legacy cross-region inference prefix from an old model ID.
 */
export function getOpenAICompatibleRegionPrefix(
  modelId: string,
): OpenAICompatibleRegionPrefix | undefined {
  const effectiveModelId = extractModelIdFromArn(modelId)

  for (const prefix of BEDROCK_REGION_PREFIXES) {
    if (effectiveModelId.startsWith(`${prefix}.openai-compatible.`)) {
      return prefix
    }
  }
  return undefined
}

/**
 * Apply a legacy region prefix only to legacy model ID shapes.
 */
export function applyOpenAICompatibleRegionPrefix(
  modelId: string,
  prefix: OpenAICompatibleRegionPrefix,
): string {
  const existingPrefix = getOpenAICompatibleRegionPrefix(modelId)
  if (existingPrefix) {
    return modelId.replace(`${existingPrefix}.`, `${prefix}.`)
  }

  if (isFoundationModel(modelId)) {
    return `${prefix}.${modelId}`
  }

  return modelId
}
