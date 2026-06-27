import memoize from 'lodash-es/memoize.js'
import { getSdkBetas } from '../bootstrap/state.js'
import { TOOL_SEARCH_BETA_HEADER_1P } from '../constants/betas.js'

export function filterAllowedSdkBetas(
  sdkBetas: string[] | undefined,
): string[] | undefined {
  return sdkBetas && sdkBetas.length > 0 ? sdkBetas : undefined
}

export function modelSupportsISP(_model: string): boolean {
  return false
}

export function modelSupportsContextManagement(_model: string): boolean {
  return false
}

export function modelSupportsStructuredOutputs(_model: string): boolean {
  return true
}

export function modelSupportsAutoMode(_model: string): boolean {
  return false
}

export function getToolSearchBetaHeader(): string {
  return TOOL_SEARCH_BETA_HEADER_1P
}

export function shouldIncludeFirstPartyOnlyBetas(): boolean {
  return false
}

export function shouldUseGlobalCacheScope(): boolean {
  return false
}

export const getAllModelBetas = memoize((_model: string): string[] => [])
export const getModelBetas = memoize((_model: string): string[] => [])
export const getOpenAICompatibleExtraBodyParamsBetas = memoize((_model: string): string[] => [])

export function getMergedBetas(
  model: string,
  _options?: { isAgenticQuery?: boolean },
): string[] {
  return [...getModelBetas(model), ...(getSdkBetas() ?? [])]
}

export function clearBetasCaches(): void {
  getAllModelBetas.cache.clear?.()
  getModelBetas.cache.clear?.()
  getOpenAICompatibleExtraBodyParamsBetas.cache.clear?.()
}
