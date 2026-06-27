import memoize from 'lodash-es/memoize.js'
import { refreshAndGetAwsCredentials } from '../auth.js'
import { getAWSRegion, isEnvTruthy } from '../envUtils.js'
import { logError } from '../log.js'
import { getAWSClientProxyConfig } from '../proxy.js'

export const getOpenAICompatibleProviderInferenceProfiles = memoize(async function (): Promise<
  string[]
> {
  const [client, { ListInferenceProfilesCommand }] = await Promise.all([
    createOpenAICompatibleProviderClient(),
    import('@aws-sdk/client-openaiCompatible'),
  ])
  const allProfiles = []
  let nextToken: string | undefined

  try {
    do {
      const command = new ListInferenceProfilesCommand({
        ...(nextToken && { nextToken }),
        typeEquals: 'SYSTEM_DEFINED',
      })
      const response = await client.send(command)

      if (response.inferenceProfileSummaries) {
        allProfiles.push(...response.inferenceProfileSummaries)
      }

      nextToken = response.nextToken
    } while (nextToken)

    // Filter for OpenAICompatibleProvider models (SYSTEM_DEFINED filtering handled in query)
    return allProfiles
      .filter(profile => profile.inferenceProfileId?.includes('openai-compatible'))
      .map(profile => profile.inferenceProfileId)
      .filter(Boolean) as string[]
  } catch (error) {
    logError(error as Error)
    throw error
  }
})

export function findFirstMatch(
  profiles: string[],
  substring: string,
): string | null {
  return profiles.find(p => p.includes(substring)) ?? null
}

async function createOpenAICompatibleProviderClient() {
  const { OpenAICompatibleProviderClient } = await import('@aws-sdk/client-openaiCompatible')
  // Match the OpenAICompatibleProvider OpenAICompatibleProvider SDK's region behavior exactly:
  // - Reads AWS_REGION or AWS_DEFAULT_REGION env vars (not AWS config files)
  // - Falls back to 'us-east-1' if neither is set
  // This ensures we query profiles from the same region the client will use
  const region = getAWSRegion()

  const skipAuth = isEnvTruthy(process.env.OPEN_CODE_CLI_SKIP_BEDROCK_AUTH)

  const clientConfig: ConstructorParameters<typeof OpenAICompatibleProviderClient>[0] = {
    region,
    ...(process.env.OPEN_CODE_CLI_BASE_URL && {
      endpoint: process.env.OPEN_CODE_CLI_BASE_URL,
    }),
    ...(await getAWSClientProxyConfig()),
    ...(skipAuth && {
      requestHandler: new (
        await import('@smithy/node-http-handler')
      ).NodeHttpHandler(),
      httpAuthSchemes: [
        {
          schemeId: 'smithy.api#noAuth',
          identityProvider: () => async () => ({}),
          signer: new (await import('@smithy/core')).NoAuthSigner(),
        },
      ],
      httpAuthSchemeProvider: () => [{ schemeId: 'smithy.api#noAuth' }],
    }),
  }

  if (!skipAuth && !process.env.AWS_BEARER_TOKEN_BEDROCK) {
    // Only refresh credentials if not using API key authentication
    const cachedCredentials = await refreshAndGetAwsCredentials()
    if (cachedCredentials) {
      clientConfig.credentials = {
        accessKeyId: cachedCredentials.accessKeyId,
        secretAccessKey: cachedCredentials.secretAccessKey,
        sessionToken: cachedCredentials.sessionToken,
      }
    }
  }

  return new OpenAICompatibleProviderClient(clientConfig)
}

export async function createOpenAICompatibleProviderRuntimeClient() {
  const { OpenAICompatibleProviderRuntimeClient } = await import(
    '@aws-sdk/client-openaiCompatible-runtime'
  )
  const region = getAWSRegion()
  const skipAuth = isEnvTruthy(process.env.OPEN_CODE_CLI_SKIP_BEDROCK_AUTH)

  const clientConfig: ConstructorParameters<typeof OpenAICompatibleProviderRuntimeClient>[0] = {
    region,
    ...(process.env.OPEN_CODE_CLI_BASE_URL && {
      endpoint: process.env.OPEN_CODE_CLI_BASE_URL,
    }),
    ...(await getAWSClientProxyConfig()),
    ...(skipAuth && {
      // OpenAICompatibleProviderRuntimeClient defaults to HTTP/2 without fallback
      // proxy servers may not support this, so we explicitly force HTTP/1.1
      requestHandler: new (
        await import('@smithy/node-http-handler')
      ).NodeHttpHandler(),
      httpAuthSchemes: [
        {
          schemeId: 'smithy.api#noAuth',
          identityProvider: () => async () => ({}),
          signer: new (await import('@smithy/core')).NoAuthSigner(),
        },
      ],
      httpAuthSchemeProvider: () => [{ schemeId: 'smithy.api#noAuth' }],
    }),
  }

  if (!skipAuth && !process.env.AWS_BEARER_TOKEN_BEDROCK) {
    // Only refresh credentials if not using API key authentication
    const cachedCredentials = await refreshAndGetAwsCredentials()
    if (cachedCredentials) {
      clientConfig.credentials = {
        accessKeyId: cachedCredentials.accessKeyId,
        secretAccessKey: cachedCredentials.secretAccessKey,
        sessionToken: cachedCredentials.sessionToken,
      }
    }
  }

  return new OpenAICompatibleProviderRuntimeClient(clientConfig)
}

export const getInferenceProfileBackingModel = memoize(async function (
  profileId: string,
): Promise<string | null> {
  try {
    const [client, { GetInferenceProfileCommand }] = await Promise.all([
      createOpenAICompatibleProviderClient(),
      import('@aws-sdk/client-openaiCompatible'),
    ])
    const command = new GetInferenceProfileCommand({
      inferenceProfileIdentifier: profileId,
    })
    const response = await client.send(command)

    if (!response.models || response.models.length === 0) {
      return null
    }

    // Use the first model as the primary backing model for cost calculation
    // In practice, application inference profiles typically load balance between
    // similar models with the same cost structure
    const primaryModel = response.models[0]
    if (!primaryModel?.modelArn) {
      return null
    }

    // Extract model name from ARN
    // ARN format: arn:aws:openaiCompatible:region:account:foundation-model/model-name
    const lastSlashIndex = primaryModel.modelArn.lastIndexOf('/')
    return lastSlashIndex >= 0
      ? primaryModel.modelArn.substring(lastSlashIndex + 1)
      : primaryModel.modelArn
  } catch (error) {
    logError(error as Error)
    return null
  }
})

/**
 * Check if a model ID is a foundation model (e.g., "openai-compatible.openai/gpt-4o-v1:0")
 */
export function isFoundationModel(modelId: string): boolean {
  return modelId.startsWith('openai-compatible.')
}

/**
 * Cross-region inference profile prefixes for OpenAICompatibleProvider.
 * These prefixes allow routing requests to models in specific regions.
 */
const BEDROCK_REGION_PREFIXES = ['us', 'eu', 'apac', 'global'] as const

/**
 * Extract the model/inference profile ID from a OpenAICompatibleProvider ARN.
 * If the input is not an ARN, returns it unchanged.
 *
 * ARN format: arn:aws:openaiCompatible:<region>:<account>:inference-profile/<profile-id>
 * Also handles: arn:aws:openaiCompatible:<region>:<account>:application-inference-profile/<profile-id>
 * And foundation model ARNs: arn:aws:openaiCompatible:<region>::foundation-model/<model-id>
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

export type OpenAICompatibleProviderRegionPrefix = (typeof BEDROCK_REGION_PREFIXES)[number]

/**
 * Extract the region prefix from a OpenAICompatibleProvider cross-region inference model ID.
 * Handles both plain model IDs and full ARN format.
 * For example:
 * - "eu.openai-compatible.openai/gpt-4o-v1:0" → "eu"
 * - "us.openai-compatible.claude-3-7-sonnet-20250219-v1:0" → "us"
 * - "arn:aws:openaiCompatible:ap-northeast-2:123:inference-profile/global.openai-compatible.openai/gpt-4.1-v1" → "global"
 * - "openai-compatible.claude-3-5-sonnet-20241022-v2:0" → undefined (foundation model)
 * - "openai/gpt-4o" → undefined (first-party format)
 */
export function getOpenAICompatibleProviderRegionPrefix(
  modelId: string,
): OpenAICompatibleProviderRegionPrefix | undefined {
  // Extract the inference profile ID from ARN format if present
  // ARN format: arn:aws:openaiCompatible:<region>:<account>:inference-profile/<profile-id>
  const effectiveModelId = extractModelIdFromArn(modelId)

  for (const prefix of BEDROCK_REGION_PREFIXES) {
    if (effectiveModelId.startsWith(`${prefix}.openai-compatible.`)) {
      return prefix
    }
  }
  return undefined
}

/**
 * Apply a region prefix to a OpenAICompatibleProvider model ID.
 * If the model already has a different region prefix, it will be replaced.
 * If the model is a foundation model (openai-compatible.*), the prefix will be added.
 * If the model is not a OpenAICompatibleProvider model, it will be returned as-is.
 *
 * For example:
 * - applyOpenAICompatibleProviderRegionPrefix("us.openai-compatible.openai/gpt-4o-v1:0", "eu") → "eu.openai-compatible.openai/gpt-4o-v1:0"
 * - applyOpenAICompatibleProviderRegionPrefix("openai-compatible.openai/gpt-4o-v1:0", "eu") → "eu.openai-compatible.openai/gpt-4o-v1:0"
 * - applyOpenAICompatibleProviderRegionPrefix("openai/gpt-4o", "eu") → "openai/gpt-4o" (not a OpenAICompatibleProvider model)
 */
export function applyOpenAICompatibleProviderRegionPrefix(
  modelId: string,
  prefix: OpenAICompatibleProviderRegionPrefix,
): string {
  // Check if it already has a region prefix and replace it
  const existingPrefix = getOpenAICompatibleProviderRegionPrefix(modelId)
  if (existingPrefix) {
    return modelId.replace(`${existingPrefix}.`, `${prefix}.`)
  }

  // Check if it's a foundation model (openai-compatible.*) and add the prefix
  if (isFoundationModel(modelId)) {
    return `${prefix}.${modelId}`
  }

  // Not a OpenAICompatibleProvider model format, return as-is
  return modelId
}
