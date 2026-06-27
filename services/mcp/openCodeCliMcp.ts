import axios from 'axios'
import memoize from 'lodash-es/memoize.js'
import { getOauthConfig } from 'src/constants/oauth.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import { getOpenCodeCliOAuthTokens } from 'src/utils/auth.js'
import { getGlobalConfig, saveGlobalConfig } from 'src/utils/config.js'
import { logForDebugging } from 'src/utils/debug.js'
import { isEnvDefinedFalsy } from 'src/utils/envUtils.js'
import { clearMcpAuthCache } from './client.js'
import { normalizeNameForMCP } from './normalization.js'
import type { ScopedMcpServerConfig } from './types.js'

type OpenCodeCliMcpServer = {
  type: 'mcp_server'
  id: string
  display_name: string
  url: string
  created_at: string
}

type OpenCodeCliMcpServersResponse = {
  data: OpenCodeCliMcpServer[]
  has_more: boolean
  next_page: string | null
}

const FETCH_TIMEOUT_MS = 5000
const MCP_SERVERS_BETA_HEADER = 'mcp-servers-2025-12-04'

/**
 * Fetches MCP server configurations from Open Code CLI org configs.
 * These servers are managed by the organization via Open Code CLI.
 *
 * Results are memoized for the session lifetime (fetch once per CLI session).
 */
export const fetchOpenCodeCliMcpConfigsIfEligible = memoize(
  async (): Promise<Record<string, ScopedMcpServerConfig>> => {
    try {
      if (isEnvDefinedFalsy(process.env.ENABLE_OPEN_CODEAI_MCP_SERVERS)) {
        logForDebugging('[openCodeCli-mcp] Disabled via env var')
        logEvent('open_code_cli_openCodeCli_mcp_eligibility', {
          state:
            'disabled_env_var' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        })
        return {}
      }

      const tokens = getOpenCodeCliOAuthTokens()
      if (!tokens?.accessToken) {
        logForDebugging('[openCodeCli-mcp] No access token')
        logEvent('open_code_cli_openCodeCli_mcp_eligibility', {
          state:
            'no_oauth_token' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        })
        return {}
      }

      // Check for user:mcp_servers scope directly instead of isOpenCodeCliSubscriber().
      // In non-interactive mode, isOpenCodeCliSubscriber() returns false when OPEN_CODE_CLI_API_KEY
      // is set (even with valid OAuth tokens) because preferThirdPartyAuthentication() causes
      // isOpenAICompatibleAuthEnabled() to return false. Checking the scope directly allows users
      // with both API keys and OAuth tokens to access Open Code CLI MCPs in print mode.
      if (!tokens.scopes?.includes('user:mcp_servers')) {
        logForDebugging(
          `[openCodeCli-mcp] Missing user:mcp_servers scope (scopes=${tokens.scopes?.join(',') || 'none'})`,
        )
        logEvent('open_code_cli_openCodeCli_mcp_eligibility', {
          state:
            'missing_scope' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        })
        return {}
      }

      const baseUrl = getOauthConfig().BASE_API_URL
      const url = `${baseUrl}/v1/mcp_servers?limit=1000`

      logForDebugging(`[openCodeCli-mcp] Fetching from ${url}`)

      const response = await axios.get<OpenCodeCliMcpServersResponse>(url, {
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
          'Content-Type': 'application/json',
          'openai-compatible-beta': MCP_SERVERS_BETA_HEADER,
        },
        timeout: FETCH_TIMEOUT_MS,
      })

      const configs: Record<string, ScopedMcpServerConfig> = {}
      // Track used normalized names to detect collisions and assign (2), (3), etc. suffixes.
      // We check the final normalized name (including suffix) to handle edge cases where
      // a suffixed name collides with another server's base name (e.g., "Example Server 2"
      // colliding with "Example Server! (2)" which both normalize to open_code_cli_ai_Example_Server_2).
      const usedNormalizedNames = new Set<string>()

      for (const server of response.data.data) {
        const baseName = `Open Code CLI ${server.display_name}`

        // Try without suffix first, then increment until we find an unused normalized name
        let finalName = baseName
        let finalNormalized = normalizeNameForMCP(finalName)
        let count = 1
        while (usedNormalizedNames.has(finalNormalized)) {
          count++
          finalName = `${baseName} (${count})`
          finalNormalized = normalizeNameForMCP(finalName)
        }
        usedNormalizedNames.add(finalNormalized)

        configs[finalName] = {
          type: 'openCodeCli-proxy',
          url: server.url,
          id: server.id,
          scope: 'openCodeCli',
        }
      }

      logForDebugging(
        `[openCodeCli-mcp] Fetched ${Object.keys(configs).length} servers`,
      )
      logEvent('open_code_cli_openCodeCli_mcp_eligibility', {
        state:
          'eligible' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      return configs
    } catch {
      logForDebugging(`[openCodeCli-mcp] Fetch failed`)
      return {}
    }
  },
)

/**
 * Clears the memoized cache for fetchOpenCodeCliMcpConfigsIfEligible.
 * Call this after login so the next fetch will use the new auth tokens.
 */
export function clearOpenCodeCliMcpConfigsCache(): void {
  fetchOpenCodeCliMcpConfigsIfEligible.cache.clear?.()
  // Also clear the auth cache so freshly-authorized servers get re-connected
  clearMcpAuthCache()
}

/**
 * Record that a Open Code CLI connector successfully connected. Idempotent.
 *
 * Gates the "N connectors unavailable/need auth" startup notifications: a
 * connector that was working yesterday and is now failed is a state change
 * worth surfacing; an org-configured connector that's been needs-auth since
 * it showed up is one the user has demonstrably ignored.
 */
export function markOpenCodeCliMcpConnected(name: string): void {
  saveGlobalConfig(current => {
    const seen = current.openCodeCliMcpEverConnected ?? []
    if (seen.includes(name)) return current
    return { ...current, openCodeCliMcpEverConnected: [...seen, name] }
  })
}

export function hasOpenCodeCliMcpEverConnected(name: string): boolean {
  return (getGlobalConfig().openCodeCliMcpEverConnected ?? []).includes(name)
}
