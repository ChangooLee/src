import type { BetaMessageParam as MessageParam } from 'src/services/api/openaiCompatible.js'
import type { Attachment } from '../utils/attachments.js'
import { normalizeAttachmentForAPI } from '../utils/messages.js'
import { jsonStringify } from '../utils/slowOperations.js'

export async function countTokensWithAPI(content: string): Promise<number | null> {
  return roughTokenCountEstimation(content)
}

export async function countMessagesTokensWithAPI(
  messages: MessageParam[],
  attachments: Attachment[] = [],
): Promise<number | null> {
  return roughTokenCountEstimationForMessages(messages, attachments)
}

export function roughTokenCountEstimation(input: string): number {
  return Math.ceil(input.length / 4)
}

export function bytesPerTokenForFileType(fileExtension: string): number {
  switch (fileExtension.toLowerCase()) {
    case '.json':
    case '.ts':
    case '.tsx':
    case '.js':
    case '.jsx':
      return 3
    default:
      return 4
  }
}

export function roughTokenCountEstimationForFileType(
  input: string,
  fileExtension: string,
): number {
  return Math.ceil(input.length / bytesPerTokenForFileType(fileExtension))
}

export async function countTokensViaHaikuFallback(
  content: string,
): Promise<number | null> {
  return roughTokenCountEstimation(content)
}

export function roughTokenCountEstimationForMessages(
  messages: MessageParam[],
  attachments: Attachment[] = [],
): number {
  const messageTokens = messages.reduce(
    (sum, message) => sum + roughTokenCountEstimationForMessage(message),
    0,
  )
  const attachmentTokens = attachments.reduce((sum, attachment) => {
    const normalized = normalizeAttachmentForAPI(attachment)
    return sum + roughTokenCountEstimation(jsonStringify(normalized))
  }, 0)
  return messageTokens + attachmentTokens
}

export function roughTokenCountEstimationForMessage(message: {
  content: unknown
}): number {
  return roughTokenCountEstimation(
    typeof message.content === 'string'
      ? message.content
      : jsonStringify(message.content),
  )
}
