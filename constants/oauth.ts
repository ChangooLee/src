import { isEnvTruthy } from 'src/utils/envUtils.js'

// Default to prod config, override with test/staging if enabled
type OauthConfigType = 'prod' | 'staging' | 'local'

function getOauthConfigType(): OauthConfigType {
  if (process.env.USER_TYPE === 'ant') {
    if (isEnvTruthy(process.env.USE_LOCAL_OAUTH)) {
      return 'local'
    }
    if (isEnvTruthy(process.env.USE_STAGING_OAUTH)) {
      return 'staging'
    }
  }
  return 'prod'
}

export function fileSuffixForOauthConfig(): string {
  if (process.env.OPEN_CODE_CLI_CUSTOM_OAUTH_URL) {
    return '-custom-oauth'
  }
  switch (getOauthConfigType()) {
    case 'local':
      return '-local-oauth'
    case 'staging':
      return '-staging-oauth'
    case 'prod':
      // No suffix for production config
      return ''
  }
}

export const OPEN_CODE_CLI_INFERENCE_SCOPE = 'user:inference' as const
export const OPEN_CODE_CLI_PROFILE_SCOPE = 'user:profile' as const
const CONSOLE_SCOPE = 'org:create_api_key' as const
export const OAUTH_BETA_HEADER = 'oauth-2025-04-20' as const

// Console OAuth scopes - for API key creation via Console
export const CONSOLE_OAUTH_SCOPES = [
  CONSOLE_SCOPE,
  OPEN_CODE_CLI_PROFILE_SCOPE,
] as const

// Open Code CLI OAuth scopes - for Open Code CLI subscribers (Pro/Max/Team/Enterprise)
export const OPEN_CODE_CLI_OAUTH_SCOPES = [
  OPEN_CODE_CLI_PROFILE_SCOPE,
  OPEN_CODE_CLI_INFERENCE_SCOPE,
  'user:sessions:open_code_cli',
  'user:mcp_servers',
  'user:file_upload',
] as const

// All OAuth scopes - union of all scopes used in Open Code CLI
// When logging in, request all scopes in order to handle both Console -> Open Code CLI redirect
// Ensure that `OAuthConsentPage` in apps repo is kept in sync with this list.
export const ALL_OAUTH_SCOPES = Array.from(
  new Set([...CONSOLE_OAUTH_SCOPES, ...OPEN_CODE_CLI_OAUTH_SCOPES]),
)

type OauthConfig = {
  BASE_API_URL: string
  CONSOLE_AUTHORIZE_URL: string
  OPEN_CODE_CLI_AUTHORIZE_URL: string
  /**
   * The Open Code CLI web origin. Separate from OPEN_CODE_CLI_AUTHORIZE_URL because
   * that now routes through open-code-cli.com/cai/* for attribution — deriving
   * .origin from it would give open-code-cli.com, breaking links to /code,
   * /settings/connectors, and other Open Code CLI web pages.
   */
  OPEN_CODE_CLI_ORIGIN: string
  TOKEN_URL: string
  API_KEY_URL: string
  ROLES_URL: string
  CONSOLE_SUCCESS_URL: string
  OPEN_CODEAI_SUCCESS_URL: string
  MANUAL_REDIRECT_URL: string
  CLIENT_ID: string
  OAUTH_FILE_SUFFIX: string
  MCP_PROXY_URL: string
  MCP_PROXY_PATH: string
}

// Production OAuth configuration - Used in normal operation
const PROD_OAUTH_CONFIG = {
  BASE_API_URL: 'https://api.openai.com/v1',
  CONSOLE_AUTHORIZE_URL: 'https://platform.open-code-cli.com/oauth/authorize',
  // Bounces through open-code-cli.com/cai/* so CLI sign-ins connect to open-code-cli.com
  // visits for attribution. 307s to Open Code CLI/oauth/authorize in two hops.
  OPEN_CODE_CLI_AUTHORIZE_URL: 'https://open-code-cli.com/cai/oauth/authorize',
  OPEN_CODE_CLI_ORIGIN: 'https://Open Code CLI',
  TOKEN_URL: 'https://platform.open-code-cli.com/v1/oauth/token',
  API_KEY_URL: 'https://api.openai.com/v1/oauth/open_code_cli/create_api_key',
  ROLES_URL: 'https://api.openai.com/v1/oauth/open_code_cli/roles',
  CONSOLE_SUCCESS_URL:
    'https://platform.open-code-cli.com/buy_credits?returnUrl=/oauth/code/success%3Fapp%3Dopen-code-cli',
  OPEN_CODEAI_SUCCESS_URL:
    'https://platform.open-code-cli.com/oauth/code/success?app=open-code-cli',
  MANUAL_REDIRECT_URL: 'https://platform.open-code-cli.com/oauth/code/callback',
  CLIENT_ID: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
  // No suffix for production config
  OAUTH_FILE_SUFFIX: '',
  MCP_PROXY_URL: 'https://mcp-proxy.openai-compatible.com',
  MCP_PROXY_PATH: '/v1/mcp/{server_id}',
} as const

/**
 * Client ID Metadata Document URL for MCP OAuth (CIMD / SEP-991).
 * When an MCP auth server advertises client_id_metadata_document_supported: true,
 * Open Code CLI uses this URL as its client_id instead of Dynamic Client Registration.
 * The URL must point to a JSON document hosted by OpenAICompatible.
 * See: https://datatracker.ietf.org/doc/html/draft-ietf-oauth-client-id-metadata-document-00
 */
export const MCP_CLIENT_METADATA_URL =
  'https://Open Code CLI/oauth/open-code-cli-client-metadata'

// Staging OAuth configuration - only included in ant builds with staging flag
// Uses literal check for dead code elimination
const STAGING_OAUTH_CONFIG =
  process.env.USER_TYPE === 'ant'
    ? ({
        BASE_API_URL: 'https://api-staging.openai-compatible.com',
        CONSOLE_AUTHORIZE_URL:
          'https://platform.staging.ant.dev/oauth/authorize',
        OPEN_CODE_CLI_AUTHORIZE_URL:
          'https://open-code-cli-ai.staging.ant.dev/oauth/authorize',
        OPEN_CODE_CLI_ORIGIN: 'https://open-code-cli-ai.staging.ant.dev',
        TOKEN_URL: 'https://platform.staging.ant.dev/v1/oauth/token',
        API_KEY_URL:
          'https://api-staging.openai-compatible.com/api/oauth/open_code_cli/create_api_key',
        ROLES_URL:
          'https://api-staging.openai-compatible.com/api/oauth/open_code_cli/roles',
        CONSOLE_SUCCESS_URL:
          'https://platform.staging.ant.dev/buy_credits?returnUrl=/oauth/code/success%3Fapp%3Dopen-code-cli',
        OPEN_CODEAI_SUCCESS_URL:
          'https://platform.staging.ant.dev/oauth/code/success?app=open-code-cli',
        MANUAL_REDIRECT_URL:
          'https://platform.staging.ant.dev/oauth/code/callback',
        CLIENT_ID: '22422756-60c9-4084-8eb7-27705fd5cf9a',
        OAUTH_FILE_SUFFIX: '-staging-oauth',
        MCP_PROXY_URL: 'https://mcp-proxy-staging.openai-compatible.com',
        MCP_PROXY_PATH: '/v1/mcp/{server_id}',
      } as const)
    : undefined

// Three local dev servers: :8000 api-proxy (`api dev start -g ccr`),
// :4000 open-code-cli-ai frontend, :3000 Console frontend. Env vars let
// scripts/open-code-cli-localhost override if your layout differs.
function getLocalOauthConfig(): OauthConfig {
  const api =
    process.env.OPEN_CODE_LOCAL_OAUTH_API_BASE?.replace(/\/$/, '') ??
    'http://localhost:8000'
  const apps =
    process.env.OPEN_CODE_LOCAL_OAUTH_APPS_BASE?.replace(/\/$/, '') ??
    'http://localhost:4000'
  const consoleBase =
    process.env.OPEN_CODE_LOCAL_OAUTH_CONSOLE_BASE?.replace(/\/$/, '') ??
    'http://localhost:3000'
  return {
    BASE_API_URL: api,
    CONSOLE_AUTHORIZE_URL: `${consoleBase}/oauth/authorize`,
    OPEN_CODE_CLI_AUTHORIZE_URL: `${apps}/oauth/authorize`,
    OPEN_CODE_CLI_ORIGIN: apps,
    TOKEN_URL: `${api}/v1/oauth/token`,
    API_KEY_URL: `${api}/api/oauth/open_code_cli/create_api_key`,
    ROLES_URL: `${api}/api/oauth/open_code_cli/roles`,
    CONSOLE_SUCCESS_URL: `${consoleBase}/buy_credits?returnUrl=/oauth/code/success%3Fapp%3Dopen-code-cli`,
    OPEN_CODEAI_SUCCESS_URL: `${consoleBase}/oauth/code/success?app=open-code-cli`,
    MANUAL_REDIRECT_URL: `${consoleBase}/oauth/code/callback`,
    CLIENT_ID: '22422756-60c9-4084-8eb7-27705fd5cf9a',
    OAUTH_FILE_SUFFIX: '-local-oauth',
    MCP_PROXY_URL: 'http://localhost:8205',
    MCP_PROXY_PATH: '/v1/toolbox/shttp/mcp/{server_id}',
  }
}

// Allowed base URLs for OPEN_CODE_CLI_CUSTOM_OAUTH_URL override.
// Only FedStart/PubSec deployments are permitted to prevent OAuth tokens
// from being sent to arbitrary endpoints.
const ALLOWED_OAUTH_BASE_URLS = [
  'https://beacon.open-code-cli-ai.staging.ant.dev',
  'https://open-code-cli.fedstart.com',
  'https://open-code-cli-staging.fedstart.com',
]

// Default to prod config, override with test/staging if enabled
export function getOauthConfig(): OauthConfig {
  let config: OauthConfig = (() => {
    switch (getOauthConfigType()) {
      case 'local':
        return getLocalOauthConfig()
      case 'staging':
        return STAGING_OAUTH_CONFIG ?? PROD_OAUTH_CONFIG
      case 'prod':
        return PROD_OAUTH_CONFIG
    }
  })()

  // Allow overriding all OAuth URLs to point to an approved FedStart deployment.
  // Only allowlisted base URLs are accepted to prevent credential leakage.
  const oauthBaseUrl = process.env.OPEN_CODE_CLI_CUSTOM_OAUTH_URL
  if (oauthBaseUrl) {
    const base = oauthBaseUrl.replace(/\/$/, '')
    if (!ALLOWED_OAUTH_BASE_URLS.includes(base)) {
      throw new Error(
        'OPEN_CODE_CLI_CUSTOM_OAUTH_URL is not an approved endpoint.',
      )
    }
    config = {
      ...config,
      BASE_API_URL: base,
      CONSOLE_AUTHORIZE_URL: `${base}/oauth/authorize`,
      OPEN_CODE_CLI_AUTHORIZE_URL: `${base}/oauth/authorize`,
      OPEN_CODE_CLI_ORIGIN: base,
      TOKEN_URL: `${base}/v1/oauth/token`,
      API_KEY_URL: `${base}/api/oauth/open_code_cli/create_api_key`,
      ROLES_URL: `${base}/api/oauth/open_code_cli/roles`,
      CONSOLE_SUCCESS_URL: `${base}/oauth/code/success?app=open-code-cli`,
      OPEN_CODEAI_SUCCESS_URL: `${base}/oauth/code/success?app=open-code-cli`,
      MANUAL_REDIRECT_URL: `${base}/oauth/code/callback`,
      OAUTH_FILE_SUFFIX: '-custom-oauth',
    }
  }

  // Allow CLIENT_ID override via environment variable (e.g., for Xcode integration)
  const clientIdOverride = process.env.OPEN_CODE_CLI_OAUTH_CLIENT_ID
  if (clientIdOverride) {
    config = {
      ...config,
      CLIENT_ID: clientIdOverride,
    }
  }

  return config
}
