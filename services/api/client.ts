import type { ClientOptions } from './providerTypes.js'
import { randomUUID } from 'crypto'
import { getUserAgent } from 'src/utils/http.js'
import { getAPIProvider } from 'src/utils/model/providers.js'
import { getIsNonInteractiveSession, getSessionId } from '../../bootstrap/state.js'
import { getApiKeyFromApiKeyHelper } from '../../utils/auth.js'
import { logForDebugging } from '../../utils/debug.js'
import { getOpenCodeCliEnv, isEnvTruthy } from '../../utils/envUtils.js'
import {
  OpenAICompatibleClient,
  resolveProviderConfig,
} from './openaiCompatible.js'

export async function getProviderClient({
  apiKey,
  maxRetries,
  model,
  fetchOverride,
  source,
}: {
  apiKey?: string
  maxRetries: number
  model?: string
  fetchOverride?: ClientOptions['fetch']
  source?: string
}): Promise<OpenAICompatibleClient> {
  const containerId = getOpenCodeCliEnv('CONTAINER_ID')
  const remoteSessionId = getOpenCodeCliEnv('REMOTE_SESSION_ID')
  const clientApp = process.env.OPEN_CODE_CLI_AGENT_SDK_CLIENT_APP
  const customHeaders = getCustomHeaders()
  const defaultHeaders: { [key: string]: string } = {
    'x-app': 'cli',
    'User-Agent': getUserAgent(),
    'X-Open-Code-CLI-Session-Id': getSessionId(),
    ...customHeaders,
    ...(containerId ? { 'x-open-code-cli-container-id': containerId } : {}),
    ...(remoteSessionId
      ? { 'x-open-code-cli-remote-session-id': remoteSessionId }
      : {}),
    ...(clientApp ? { 'x-client-app': clientApp } : {}),
  }

  logForDebugging(
    `[API:request] Creating OpenAI-compatible client, OPEN_CODE_CLI_CUSTOM_HEADERS present: ${!!process.env.OPEN_CODE_CLI_CUSTOM_HEADERS}, has Authorization header: ${!!customHeaders['Authorization']}, source=${source ?? 'unknown'}, model=${model ?? 'default'}, maxRetries=${maxRetries}`,
  )

  const additionalProtectionEnabled = isEnvTruthy(
    getOpenCodeCliEnv('ADDITIONAL_PROTECTION'),
  )
  if (additionalProtectionEnabled) {
    defaultHeaders['x-open-code-cli-additional-protection'] = 'true'
  }

  const resolvedFetch = buildFetch(fetchOverride, source)
  const resolvedApiKey =
    apiKey ??
    process.env.OPEN_CODE_CLI_API_KEY ??
    process.env.OPENAI_API_KEY ??
    (await getApiKeyFromApiKeyHelper(getIsNonInteractiveSession()))
  return new OpenAICompatibleClient(
    resolveProviderConfig({
      apiKey: resolvedApiKey,
      defaultHeaders,
      fetchOverride: resolvedFetch,
    }),
  )
}

function getCustomHeaders(): Record<string, string> {
  const customHeaders: Record<string, string> = {}
  const customHeadersEnv = process.env.OPEN_CODE_CLI_CUSTOM_HEADERS

  if (!customHeadersEnv) return customHeaders

  // Split by newlines to support multiple headers
  const headerStrings = customHeadersEnv.split(/\n|\r\n/)

  for (const headerString of headerStrings) {
    if (!headerString.trim()) continue

    // Parse header in format "Name: Value" (curl style). Split on first `:`
    const colonIdx = headerString.indexOf(':')
    if (colonIdx === -1) continue
    const name = headerString.slice(0, colonIdx).trim()
    const value = headerString.slice(colonIdx + 1).trim()
    if (name) {
      customHeaders[name] = value
    }
  }

  return customHeaders
}

export const CLIENT_REQUEST_ID_HEADER = 'x-client-request-id'

function buildFetch(
  fetchOverride: ClientOptions['fetch'],
  source: string | undefined,
): ClientOptions['fetch'] {
  // eslint-disable-next-line eslint-plugin-n/no-unsupported-features/node-builtins
  const inner = fetchOverride ?? globalThis.fetch
  return (input, init) => {
    // eslint-disable-next-line eslint-plugin-n/no-unsupported-features/node-builtins
    const headers = new Headers(init?.headers)
    if (!headers.has(CLIENT_REQUEST_ID_HEADER)) {
      headers.set(CLIENT_REQUEST_ID_HEADER, randomUUID())
    }
    try {
      // eslint-disable-next-line eslint-plugin-n/no-unsupported-features/node-builtins
      const url = input instanceof Request ? input.url : String(input)
      const id = headers.get(CLIENT_REQUEST_ID_HEADER)
      logForDebugging(
        `[API REQUEST] ${new URL(url).pathname}${id ? ` ${CLIENT_REQUEST_ID_HEADER}=${id}` : ''} source=${source ?? 'unknown'} provider=${getAPIProvider()}`,
      )
    } catch {
      // never let logging crash the fetch
    }
    return inner(input, { ...init, headers })
  }
}
