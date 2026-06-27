import { logForDebugging } from '../debug.js'

export type OpenCodeInChromeContext = Record<string, never>

export function createChromeContext(): OpenCodeInChromeContext {
  throw new Error('Open Code in Chrome MCP is not available in this build.')
}

export async function runOpenCodeInChromeMcpServer(): Promise<void> {
  logForDebugging('[Open Code in Chrome] MCP server is not available in this build', {
    level: 'warn',
  })
  throw new Error('Open Code in Chrome MCP is not available in this build.')
}
