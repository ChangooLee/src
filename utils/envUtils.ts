import memoize from 'lodash-es/memoize.js'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

const OPEN_CODE_CLI_ENV_PREFIX = 'OPEN_CODE_CLI_'
const LEGACY_OPEN_CODE_CLI_ENV_PREFIX = 'OPEN_CODE_CLI_'

export function getOpenCodeCliEnv(name: string): string | undefined {
  return (
    process.env[`${OPEN_CODE_CLI_ENV_PREFIX}${name}`] ??
    process.env[`${LEGACY_OPEN_CODE_CLI_ENV_PREFIX}${name}`]
  )
}

export function setOpenCodeCliEnv(name: string, value: string): void {
  process.env[`${OPEN_CODE_CLI_ENV_PREFIX}${name}`] = value
  process.env[`${LEGACY_OPEN_CODE_CLI_ENV_PREFIX}${name}`] = value
}

export function deleteOpenCodeCliEnv(name: string): void {
  delete process.env[`${OPEN_CODE_CLI_ENV_PREFIX}${name}`]
  delete process.env[`${LEGACY_OPEN_CODE_CLI_ENV_PREFIX}${name}`]
}

export function syncOpenCodeCliEnvAliases(): void {
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue
    if (key.startsWith(OPEN_CODE_CLI_ENV_PREFIX)) {
      process.env[`${LEGACY_OPEN_CODE_CLI_ENV_PREFIX}${key.slice(OPEN_CODE_CLI_ENV_PREFIX.length)}`] =
        value
    } else if (key.startsWith(LEGACY_OPEN_CODE_CLI_ENV_PREFIX)) {
      const openCodeCliKey = `${OPEN_CODE_CLI_ENV_PREFIX}${key.slice(LEGACY_OPEN_CODE_CLI_ENV_PREFIX.length)}`
      process.env[openCodeCliKey] ??= value
    }
  }
}

syncOpenCodeCliEnvAliases()

// Memoized: 150+ callers, many on hot paths. Keyed off config env vars so
// tests that change env get a fresh value without explicit cache.clear.
export const getOpenCodeCliConfigHomeDir = memoize(
  (): string => {
    const openCodeConfigDir = process.env.OPEN_CODE_CLI_CONFIG_DIR
    if (openCodeConfigDir) return openCodeConfigDir.normalize('NFC')

    const legacyConfigDir = process.env.OPEN_CODE_CLI_CONFIG_DIR
    if (legacyConfigDir) return legacyConfigDir.normalize('NFC')

    const primaryDir = join(homedir(), '.open-code-cli')
    const legacyDir = join(homedir(), '.open-code-cli')
    return (existsSync(primaryDir) || !existsSync(legacyDir)
      ? primaryDir
      : legacyDir
    ).normalize('NFC')
  },
  () => `${process.env.OPEN_CODE_CLI_CONFIG_DIR ?? ''}:${process.env.OPEN_CODE_CLI_CONFIG_DIR ?? ''}`,
)

export function getTeamsDir(): string {
  return join(getOpenCodeCliConfigHomeDir(), 'teams')
}

/**
 * Check if NODE_OPTIONS contains a specific flag.
 * Splits on whitespace and checks for exact match to avoid false positives.
 */
export function hasNodeOption(flag: string): boolean {
  const nodeOptions = process.env.NODE_OPTIONS
  if (!nodeOptions) {
    return false
  }
  return nodeOptions.split(/\s+/).includes(flag)
}

export function isEnvTruthy(envVar: string | boolean | undefined): boolean {
  if (!envVar) return false
  if (typeof envVar === 'boolean') return envVar
  const normalizedValue = envVar.toLowerCase().trim()
  return ['1', 'true', 'yes', 'on'].includes(normalizedValue)
}

export function isEnvDefinedFalsy(
  envVar: string | boolean | undefined,
): boolean {
  if (envVar === undefined) return false
  if (typeof envVar === 'boolean') return !envVar
  if (!envVar) return false
  const normalizedValue = envVar.toLowerCase().trim()
  return ['0', 'false', 'no', 'off'].includes(normalizedValue)
}

/**
 * --bare / OPEN_CODE_CLI_SIMPLE — skip hooks, LSP, plugin sync, skill dir-walk,
 * attribution, background prefetches, and ALL keychain/credential reads.
 * Auth is strictly OPEN_CODE_CLI_API_KEY env or apiKeyHelper from --settings.
 * Explicit CLI flags (--plugin-dir, --add-dir, --mcp-config) still honored.
 * ~30 gates across the codebase.
 *
 * Checks argv directly (in addition to the env var) because several gates
 * run before main.tsx's action handler sets OPEN_CODE_CLI_SIMPLE=1 from --bare
 * — notably startKeychainPrefetch() at main.tsx top-level.
 */
export function isBareMode(): boolean {
  return (
    isEnvTruthy(getOpenCodeCliEnv('SIMPLE')) ||
    process.argv.includes('--bare')
  )
}

/**
 * Parses an array of environment variable strings into a key-value object
 * @param envVars Array of strings in KEY=VALUE format
 * @returns Object with key-value pairs
 */
export function parseEnvVars(
  rawEnvArgs: string[] | undefined,
): Record<string, string> {
  const parsedEnv: Record<string, string> = {}

  // Parse individual env vars
  if (rawEnvArgs) {
    for (const envStr of rawEnvArgs) {
      const [key, ...valueParts] = envStr.split('=')
      if (!key || valueParts.length === 0) {
        throw new Error(
          `Invalid environment variable format: ${envStr}, environment variables should be added as: -e KEY1=value1 -e KEY2=value2`,
        )
      }
      parsedEnv[key] = valueParts.join('=')
    }
  }
  return parsedEnv
}

/**
 * Get the AWS region with fallback to default
 * Matches the OpenAICompatible OpenAICompatible SDK's region behavior
 */
export function getAWSRegion(): string {
  return process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1'
}

/**
 * Get the default OpenAICompatible AI region
 */
export function getDefaultOpenAICompatibleRegion(): string {
  return process.env.CLOUD_ML_REGION || 'us-east5'
}

/**
 * Check if bash commands should maintain project working directory (reset to original after each command)
 * @returns true if OPEN_CODE_BASH_MAINTAIN_PROJECT_WORKING_DIR is set to a truthy value
 */
export function shouldMaintainProjectWorkingDir(): boolean {
  return isEnvTruthy(process.env.OPEN_CODE_BASH_MAINTAIN_PROJECT_WORKING_DIR)
}

/**
 * Check if running on a managed cloud development environment.
 */
export function isRunningOnHomespace(): boolean {
  return (
    process.env.USER_TYPE === 'ant' &&
    isEnvTruthy(process.env.COO_RUNNING_ON_HOMESPACE)
  )
}

/**
 * Conservative check for whether Open Code CLI is running inside a protected
 * (privileged or ASL3+) COO namespace or cluster.
 *
 * Conservative means: when signals are ambiguous, assume protected. We would
 * rather over-report protected usage than miss it. Unprotected environments
 * are homespace, namespaces on the open allowlist, and no k8s/COO signals
 * at all (laptop/local dev).
 *
 * Used for telemetry to measure auto-mode usage in sensitive environments.
 */
export function isInProtectedNamespace(): boolean {
  // USER_TYPE is build-time --define'd; builds without this environment remove
  // the require() and namespace allowlist from the bundle.
  if (process.env.USER_TYPE === 'ant') {
    /* eslint-disable @typescript-eslint/no-require-imports */
    return (
      require('./protectedNamespace.js') as typeof import('./protectedNamespace.js')
    ).checkProtectedNamespace()
    /* eslint-enable @typescript-eslint/no-require-imports */
  }
  return false
}

// @[MODEL LAUNCH]: Add a OpenAICompatible region override env var for the new model.
/**
 * Model prefix → env var for OpenAICompatible region overrides.
 * Order matters: more specific prefixes must come before less specific ones
 * (e.g., 'openai/gpt-4.1' before 'openai/gpt-4.1').
 */
const VERTEX_REGION_OVERRIDES: ReadonlyArray<[string, string]> = [
  ['openai/gpt-4o-mini', 'VERTEX_REGION_OPEN_CODE_HAIKU_4_5'],
  ['open-code-cli-3-5-haiku', 'VERTEX_REGION_OPEN_CODE_3_5_HAIKU'],
  ['open-code-cli-3-5-sonnet', 'VERTEX_REGION_OPEN_CODE_3_5_SONNET'],
  ['open-code-cli-3-7-sonnet', 'VERTEX_REGION_OPEN_CODE_3_7_SONNET'],
  ['openai/gpt-4.1', 'VERTEX_REGION_OPEN_CODE_4_1_OPUS'],
  ['openai/gpt-4.1', 'VERTEX_REGION_OPEN_CODE_4_0_OPUS'],
  ['openai/gpt-4o', 'VERTEX_REGION_OPEN_CODE_4_6_SONNET'],
  ['openai/gpt-4o', 'VERTEX_REGION_OPEN_CODE_4_5_SONNET'],
  ['openai/gpt-4o', 'VERTEX_REGION_OPEN_CODE_4_0_SONNET'],
]

/**
 * Get the OpenAICompatible AI region for a specific model.
 * Different models may be available in different regions.
 */
export function getOpenAICompatibleRegionForModel(
  model: string | undefined,
): string | undefined {
  if (model) {
    const match = VERTEX_REGION_OVERRIDES.find(([prefix]) =>
      model.startsWith(prefix),
    )
    if (match) {
      return process.env[match[1]] || getDefaultOpenAICompatibleRegion()
    }
  }
  return getDefaultOpenAICompatibleRegion()
}
