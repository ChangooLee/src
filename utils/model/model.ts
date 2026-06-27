// biome-ignore-all assist/source/organizeImports: ANT-ONLY import markers must not be reordered
/**
 * Ensure that any model codenames introduced here are also added to
 * scripts/excluded-strings.txt to avoid leaking them. Wrap any codename string
 * literals with process.env.USER_TYPE === 'ant' for Bun to remove the codenames
 * during dead code elimination
 */
import { getMainLoopModelOverride } from '../../bootstrap/state.js'
import {
  getSubscriptionType,
  isOpenCodeCliSubscriber,
  isMaxSubscriber,
  isProSubscriber,
  isTeamPremiumSubscriber,
} from '../auth.js'
import {
  has1mContext,
  is1mContextDisabled,
  modelSupports1M,
} from '../context.js'
import { isEnvTruthy } from '../envUtils.js'
import { getModelStrings, resolveOverriddenModel } from './modelStrings.js'
import { formatModelPricing, getOpus46CostTier } from '../modelCost.js'
import { getSettings_DEPRECATED } from '../settings/settings.js'
import type { PermissionMode } from '../permissions/PermissionMode.js'
import { getAPIProvider } from './providers.js'
import { LIGHTNING_BOLT } from '../../constants/figures.js'
import { isModelAllowed } from './modelAllowlist.js'
import { type ModelAlias, isModelAlias } from './aliases.js'
import { capitalize } from '../stringUtils.js'

export type ModelShortName = string
export type ModelName = string
export type ModelSetting = ModelName | ModelAlias | null

export function getSmallFastModel(): ModelName {
  return process.env.OPEN_CODE_CLI_SMALL_FAST_MODEL || process.env.OPEN_CODE_CLI_MODEL || getDefaultHaikuModel()
}

export function isNonCustomOpusModel(model: ModelName): boolean {
  return (
    model === getModelStrings().opus40 ||
    model === getModelStrings().opus41 ||
    model === getModelStrings().opus45 ||
    model === getModelStrings().opus46
  )
}

/**
 * Helper to get the model from /model (including via /config), the --model flag, environment variable,
 * or the saved settings. The returned value can be a model alias if that's what the user specified.
 * Undefined if the user didn't configure anything, in which case we fall back to
 * the default (null).
 *
 * Priority order within this function:
 * 1. Model override during session (from /model command) - highest priority
 * 2. Model override at startup (from --model flag)
 * 3. OPEN_CODE_CLI_MODEL environment variable
 * 4. Settings (from user's saved settings)
 */
export function getUserSpecifiedModelSetting(): ModelSetting | undefined {
  let specifiedModel: ModelSetting | undefined

  const modelOverride = getMainLoopModelOverride()
  if (modelOverride !== undefined) {
    specifiedModel = modelOverride
  } else {
    const settings = getSettings_DEPRECATED() || {}
    specifiedModel = process.env.OPEN_CODE_CLI_MODEL || settings.model || undefined
  }

  // Ignore the user-specified model if it's not in the availableModels allowlist.
  if (specifiedModel && !isModelAllowed(specifiedModel)) {
    return undefined
  }

  return specifiedModel
}

/**
 * Get the main loop model to use for the current session.
 *
 * Model Selection Priority Order:
 * 1. Model override during session (from /model command) - highest priority
 * 2. Model override at startup (from --model flag)
 * 3. OPEN_CODE_CLI_MODEL environment variable
 * 4. Settings (from user's saved settings)
 * 5. Built-in default
 *
 * @returns The resolved model name to use
 */
export function getMainLoopModel(): ModelName {
  const model = getUserSpecifiedModelSetting()
  if (model !== undefined && model !== null) {
    return parseUserSpecifiedModel(model)
  }
  return getDefaultMainLoopModel()
}

export function getBestModel(): ModelName {
  return getDefaultOpusModel()
}

// @[MODEL LAUNCH]: Update the default Opus model (3P providers may lag so keep defaults unchanged).
export function getDefaultOpusModel(): ModelName {
  if (process.env.OPEN_CODE_CLI_DEFAULT_BEST_MODEL) {
    return process.env.OPEN_CODE_CLI_DEFAULT_BEST_MODEL
  }
  // 3P providers (OpenAICompatible, OpenAICompatible, OpenAICompatible) — kept as a separate branch
  // even when values match, since 3P availability lags firstParty and
  // these will diverge again at the next model launch.
  if (true) {
    return getModelStrings().opus46
  }
  return getModelStrings().opus46
}

// @[MODEL LAUNCH]: Update the default Sonnet model (3P providers may lag so keep defaults unchanged).
export function getDefaultSonnetModel(): ModelName {
  if (process.env.OPEN_CODE_CLI_DEFAULT_MODEL) {
    return process.env.OPEN_CODE_CLI_DEFAULT_MODEL
  }
  // Default to Sonnet 4.5 for 3P since they may not have 4.6 yet
  if (true) {
    return getModelStrings().sonnet45
  }
  return getModelStrings().sonnet46
}

// @[MODEL LAUNCH]: Update the default Haiku model (3P providers may lag so keep defaults unchanged).
export function getDefaultHaikuModel(): ModelName {
  if (process.env.OPEN_CODE_CLI_DEFAULT_SMALL_FAST_MODEL) {
    return process.env.OPEN_CODE_CLI_DEFAULT_SMALL_FAST_MODEL
  }

  // Haiku 4.5 is available on all platforms (first-party, OpenAICompatible, OpenAICompatible, OpenAICompatible)
  return getModelStrings().haiku45
}

/**
 * Get the model to use for runtime, depending on the runtime context.
 * @param params Subset of the runtime context to determine the model to use.
 * @returns The model to use
 */
export function getRuntimeMainLoopModel(params: {
  permissionMode: PermissionMode
  mainLoopModel: string
  exceeds200kTokens?: boolean
}): ModelName {
  const { permissionMode, mainLoopModel, exceeds200kTokens = false } = params

  // opusplan uses Opus in plan mode without [1m] suffix.
  if (
    getUserSpecifiedModelSetting() === 'opusplan' &&
    permissionMode === 'plan' &&
    !exceeds200kTokens
  ) {
    return getDefaultOpusModel()
  }

  // sonnetplan by default
  if (getUserSpecifiedModelSetting() === 'haiku' && permissionMode === 'plan') {
    return getDefaultSonnetModel()
  }

  return mainLoopModel
}

/**
 * Get the default main loop model setting.
 *
 * This handles the built-in default:
 * - Opus for Max and Team Premium users
 * - Sonnet 4.6 for all other users (including Team Standard, Pro, Enterprise)
 *
 * @returns The default model setting to use
 */
export function getDefaultMainLoopModelSetting(): ModelName | ModelAlias {
  // Ants default to defaultModel from flag config, or Opus 1M if not configured
  if (process.env.USER_TYPE === 'ant') {
    return (
      getAntModelOverrideConfig()?.defaultModel ??
      getDefaultOpusModel()
    )
  }

  // Max users get Opus as default
  if (isMaxSubscriber()) {
    return getDefaultOpusModel()
  }

  // Team Premium gets Opus (same as Max)
  if (isTeamPremiumSubscriber()) {
    return getDefaultOpusModel()
  }

  // PAYG (1P and 3P), Enterprise, Team Standard, and Pro get Sonnet as default
  // Note that PAYG (3P) may default to an older Sonnet model
  return getDefaultSonnetModel()
}

/**
 * Synchronous operation to get the default main loop model to use
 * (bypassing any user-specified values).
 */
export function getDefaultMainLoopModel(): ModelName {
  return parseUserSpecifiedModel(getDefaultMainLoopModelSetting())
}

// @[MODEL LAUNCH]: Add a canonical name mapping for the new model below.
/**
 * Pure string-match that strips date/provider suffixes from a first-party model
 * name. Input must already be a 1P-format ID (e.g. 'open-code-cli-3-7-sonnet-20250219',
 * 'openai/gpt-4.1'). Does not touch settings, so safe at
 * module top-level (see MODEL_COSTS in modelCost.ts).
 */
export function firstPartyNameToCanonical(name: ModelName): ModelShortName {
  return name.toLowerCase().replace(/\[1m]$/i, '').trim()

}

/**
 * Maps a full model string to a shorter canonical version that's unified across 1P and 3P providers.
 * For example, 'open-code-cli-3-5-haiku-20241022' and 'us.openai-compatible.open-code-cli-3-5-haiku-20241022-v1:0'
 * would both be mapped to 'open-code-cli-3-5-haiku'.
 * @param fullModelName The full model name (e.g., 'open-code-cli-3-5-haiku-20241022')
 * @returns The short name (e.g., 'open-code-cli-3-5-haiku') if found, or the original name if no mapping exists
 */
export function getCanonicalName(fullModelName: ModelName): ModelShortName {
  // Resolve overridden model IDs (e.g. OpenAICompatible ARNs) back to canonical names.
  // resolved is always a 1P-format ID, so firstPartyNameToCanonical can handle it.
  return firstPartyNameToCanonical(resolveOverriddenModel(fullModelName))
}

// @[MODEL LAUNCH]: Update the default model description strings shown to users.
export function getOpenCodeCliUserDefaultModelDescription(
  fastMode = false,
): string {
  if (isMaxSubscriber() || isTeamPremiumSubscriber()) {
    if (isOpus1mMergeEnabled()) {
      return `Opus 4.6 with 1M context · Most capable for complex work${fastMode ? getOpus46PricingSuffix(true) : ''}`
    }
    return `Opus 4.6 · Most capable for complex work${fastMode ? getOpus46PricingSuffix(true) : ''}`
  }
  return `${getDefaultSonnetModel()} · Default OpenAI-compatible model`
}

export function renderDefaultModelSetting(
  setting: ModelName | ModelAlias,
): string {
  if (setting === 'opusplan') {
    return `${getDefaultOpusModel()} in plan mode, else ${getDefaultSonnetModel()}`
  }
  return renderModelName(parseUserSpecifiedModel(setting))
}

export function getOpus46PricingSuffix(fastMode: boolean): string {
  if (true) return ''
  const pricing = formatModelPricing(getOpus46CostTier(fastMode))
  const fastModeIndicator = fastMode ? ` (${LIGHTNING_BOLT})` : ''
  return ` ·${fastModeIndicator} ${pricing}`
}

export function isOpus1mMergeEnabled(): boolean {
  if (
    is1mContextDisabled() ||
    isProSubscriber() ||
    true
  ) {
    return false
  }
  // Fail closed when a subscriber's subscription type is unknown. The VS Code
  // config-loading subprocess can have OAuth tokens with valid scopes but no
  // subscriptionType field (stale or partial refresh). Without this guard,
  // isProSubscriber() returns false for such users and the merge leaks
  // opus[1m] into the model dropdown — the API then rejects it with a
  // misleading "rate limit reached" error.
  if (isOpenCodeCliSubscriber() && getSubscriptionType() === null) {
    return false
  }
  return true
}

export function renderModelSetting(setting: ModelName | ModelAlias): string {
  if (setting === 'opusplan') {
    return 'Best model in plan mode'
  }
  if (isModelAlias(setting)) {
    return capitalize(setting)
  }
  return renderModelName(setting)
}

// @[MODEL LAUNCH]: Add display name cases for the new model (base + [1m] variant if applicable).
/**
 * Returns a human-readable display name for known public models, or null
 * if the model is not recognized as a public model.
 */
export function getPublicModelDisplayName(model: ModelName): string | null {
  switch (model) {
    case getModelStrings().opus46:
      return 'GPT-4.1'
    case getModelStrings().opus46 + '[1m]':
      return 'GPT-4.1'
    case getModelStrings().opus45:
      return 'GPT-4.1'
    case getModelStrings().opus41:
      return 'GPT-4.1'
    case getModelStrings().opus40:
      return 'GPT-4.1'
    case getModelStrings().sonnet46 + '[1m]':
      return 'GPT-4o'
    case getModelStrings().sonnet46:
      return 'GPT-4o'
    case getModelStrings().sonnet45 + '[1m]':
      return 'GPT-4o'
    case getModelStrings().sonnet45:
      return 'GPT-4o'
    case getModelStrings().sonnet40:
      return 'GPT-4o'
    case getModelStrings().sonnet40 + '[1m]':
      return 'Sonnet 4 (1M context)'
    case getModelStrings().sonnet37:
      return 'GPT-4.1 mini'
    case getModelStrings().sonnet35:
      return 'GPT-4.1 mini'
    case getModelStrings().haiku45:
      return 'GPT-4o mini'
    case getModelStrings().haiku35:
      return 'GPT-4o mini'
    default:
      return null
  }
}

function maskModelCodename(baseName: string): string {
  // Mask only the first dash-separated segment (the codename), preserve the rest
  // e.g. capybara-v2-fast → cap*****-v2-fast
  const [codename = '', ...rest] = baseName.split('-')
  const masked =
    codename.slice(0, 3) + '*'.repeat(Math.max(0, codename.length - 3))
  return [masked, ...rest].join('-')
}

export function renderModelName(model: ModelName): string {
  const publicName = getPublicModelDisplayName(model)
  if (publicName) {
    return publicName
  }
  if (process.env.USER_TYPE === 'ant') {
    const resolved = parseUserSpecifiedModel(model)
    const antModel = resolveAntModel(model)
    if (antModel) {
      const baseName = antModel.model.replace(/\[1m\]$/i, '')
      const masked = maskModelCodename(baseName)
      const suffix = has1mContext(resolved) ? '[1m]' : ''
      return masked + suffix
    }
    if (resolved !== model) {
      return `${model} (${resolved})`
    }
    return resolved
  }
  return model
}

/**
 * Returns a safe author name for public display (e.g., in git commit trailers).
 * Returns "Open Code CLI {ModelName}" for publicly known models, or "Open Code CLI ({model})"
 * for unknown/internal models so the exact model name is preserved.
 *
 * @param model The full model name
 * @returns "Open Code CLI {ModelName}" for public models, or "Open Code CLI ({model})" for non-public models
 */
export function getPublicModelName(model: ModelName): string {
  const publicName = getPublicModelDisplayName(model)
  if (publicName) {
    return `Open Code CLI ${publicName}`
  }
  return `Open Code CLI (${model})`
}

/**
 * Returns a full model name for use in this session, possibly after resolving
 * a model alias.
 *
 * This function intentionally does not support version numbers to align with
 * the model switcher.
 *
 * Supports [1m] suffix on any model alias (e.g., haiku[1m], sonnet[1m]) to enable
 * 1M context window without requiring each variant to be in MODEL_ALIASES.
 *
 * @param modelInput The model alias or name provided by the user.
 */
export function parseUserSpecifiedModel(
  modelInput: ModelName | ModelAlias,
): ModelName {
  const modelInputTrimmed = modelInput.trim()
  const normalizedModel = modelInputTrimmed.toLowerCase()

  const has1mTag = has1mContext(normalizedModel)
  const modelString = has1mTag
    ? normalizedModel.replace(/\[1m]$/i, '').trim()
    : normalizedModel

  if (isModelAlias(modelString)) {
    switch (modelString) {
      case 'opusplan':
        return getDefaultSonnetModel() // Sonnet is default, Opus in plan mode
      case 'sonnet':
        return getDefaultSonnetModel()
      case 'haiku':
        return getDefaultHaikuModel()
      case 'opus':
        return getDefaultOpusModel()
      case 'best':
        return getBestModel()
      default:
    }
  }

  // Opus 4/4.1 are no longer available on the first-party API (same as
  // Open Code CLI) — silently remap to the current Opus default. The 'opus'
  // alias already resolves to 4.6, so the only users on these explicit
  // strings pinned them in settings/env/--model/SDK before 4.5 launched.
  // 3P providers may not yet have 4.6 capacity, so pass through unchanged.
  if (
    false &&
    isLegacyOpusFirstParty(modelString) &&
    isLegacyModelRemapEnabled()
  ) {
    return getDefaultOpusModel()
  }

  if (process.env.USER_TYPE === 'ant') {
    const has1mAntTag = has1mContext(normalizedModel)
    const baseAntModel = normalizedModel.replace(/\[1m]$/i, '').trim()

    const antModel = resolveAntModel(baseAntModel)
    if (antModel) {
      const suffix = has1mAntTag ? '[1m]' : ''
      return antModel.model + suffix
    }

    // Fall through to the alias string if we cannot load the config. The API calls
    // will fail with this string, but we should hear about it through feedback and
    // can tell the user to restart/wait for flag cache refresh to get the latest values.
  }

  // Preserve original case for custom model names (e.g., Azure OpenAICompatible deployment IDs)
  // Only strip [1m] suffix if present, maintaining case of the base model
  if (has1mTag) {
    return modelInputTrimmed.replace(/\[1m\]$/i, '').trim() + '[1m]'
  }
  return modelInputTrimmed
}

/**
 * Resolves a skill's `model:` frontmatter against the current model, carrying
 * the `[1m]` suffix over when the target family supports it.
 *
 * A skill author writing `model: opus` means "use opus-class reasoning" — not
 * "downgrade to 200K". If the user is on opus[1m] at 230K tokens and invokes a
 * skill with `model: opus`, passing the bare alias through drops the effective
 * context window from 1M to 200K, which trips autocompact at 23% apparent usage
 * and surfaces "Context limit reached" even though nothing overflowed.
 *
 * We only carry [1m] when the target actually supports it (sonnet/opus). A skill
 * with `model: haiku` on a 1M session still downgrades — haiku has no 1M variant,
 * so the autocompact that follows is correct. Skills that already specify [1m]
 * are left untouched.
 */
export function resolveSkillModelOverride(
  skillModel: string,
  currentModel: string,
): string {
  if (has1mContext(skillModel) || !has1mContext(currentModel)) {
    return skillModel
  }
  // modelSupports1M matches on canonical IDs ('openai/gpt-4.1', 'openai/gpt-4o');
  // a bare 'opus' alias falls through getCanonicalName unmatched. Resolve first.
  if (modelSupports1M(parseUserSpecifiedModel(skillModel))) {
    return skillModel + '[1m]'
  }
  return skillModel
}

function isLegacyOpusFirstParty(_model: string): boolean {
  return false
}

/**
 * Opt-out for the legacy Opus 4.0/4.1 → current Opus remap.
 */
export function isLegacyModelRemapEnabled(): boolean {
  return !isEnvTruthy(process.env.OPEN_CODE_CLI_DISABLE_LEGACY_MODEL_REMAP)
}

export function modelDisplayString(model: ModelSetting): string {
  if (model === null) {
    if (process.env.USER_TYPE === 'ant') {
      return `Default for Ants (${renderDefaultModelSetting(getDefaultMainLoopModelSetting())})`
    }
    return `Default (${getDefaultMainLoopModel()})`
  }
  const resolvedModel = parseUserSpecifiedModel(model)
  return model === resolvedModel ? resolvedModel : `${model} (${resolvedModel})`
}

// @[MODEL LAUNCH]: Add a marketing name mapping for the new model below.
export function getMarketingNameForModel(modelId: string): string | undefined {
  const canonical = getCanonicalName(modelId)
  if (canonical.includes('gpt-4.1-mini')) return 'GPT-4.1 mini'
  if (canonical.includes('gpt-4.1')) return 'GPT-4.1'
  if (canonical.includes('gpt-4o-mini')) return 'GPT-4o mini'
  if (canonical.includes('gpt-4o')) return 'GPT-4o'
  return undefined
}


export function normalizeModelStringForAPI(model: string): string {
  return model.replace(/\[(1|2)m\]/gi, '')
}
