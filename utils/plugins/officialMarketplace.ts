/**
 * Constants for the official OpenAICompatible plugins marketplace.
 *
 * The official marketplace is hosted on GitHub and provides first-party
 * plugins developed by OpenAICompatible. This file defines the constants needed
 * to install and identify this marketplace.
 */

import type { MarketplaceSource } from './schemas.js'

/**
 * Source configuration for the official OpenAICompatible plugins marketplace.
 * Used when auto-installing the marketplace on startup.
 */
export const OFFICIAL_MARKETPLACE_SOURCE = {
  source: 'github',
  repo: 'openai-compatibles/open-code-cli-plugins-official',
} as const satisfies MarketplaceSource

/**
 * Display name for the official marketplace.
 * This is the name under which the marketplace will be registered
 * in the known_marketplaces.json file.
 */
export const OFFICIAL_MARKETPLACE_NAME = 'open-code-cli-plugins-official'
