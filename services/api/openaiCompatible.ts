import { randomUUID } from 'crypto'
import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
  type BetaContentBlock,
  type BetaMessage,
  type BetaMessageStreamParams,
  type BetaRawMessageStreamEvent,
  type BetaStopReason,
  type ClientOptions,
  type ContentBlockParam,
  type MessageParam,
  type Stream,
  type ToolUseBlock,
} from './providerTypes.js'

export * from './providerTypes.js'

type OpenAIMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string | OpenAIContentPart[] }
  | {
      role: 'assistant'
      content?: string | null
      tool_calls?: OpenAIToolCall[]
    }
  | { role: 'tool'; tool_call_id: string; content: string }

type OpenAIContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

type OpenAIToolCall = {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

type OpenAIChatCompletion = {
  id?: string
  model?: string
  choices?: Array<{
    finish_reason?: string | null
    message?: {
      content?: string | null
      tool_calls?: OpenAIToolCall[]
    }
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
  }
}

type OpenAIStreamChunk = {
  id?: string
  model?: string
  choices?: Array<{
    finish_reason?: string | null
    delta?: {
      content?: string | null
      tool_calls?: Array<{
        index?: number
        id?: string
        type?: 'function'
        function?: { name?: string; arguments?: string }
      }>
    }
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
  }
}

type RequestOptions = {
  signal?: AbortSignal
  timeout?: number
  headers?: Record<string, string>
}

class ProviderResponse<T> implements PromiseLike<T> {
  constructor(
    private readonly run: () => Promise<{ data: T; response: Response }>,
  ) {}

  then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.run().then(({ data }) => data).then(onfulfilled, onrejected)
  }

  catch<TResult = never>(
    onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null,
  ): Promise<T | TResult> {
    return this.then(undefined, onrejected)
  }

  finally(onfinally?: (() => void) | null): Promise<T> {
    return this.then(value => value).finally(onfinally ?? undefined)
  }

  async withResponse(): Promise<{
    data: T
    response: Response
    request_id: string | null
  }> {
    const { data, response } = await this.run()
    return {
      data,
      response,
      request_id:
        response.headers.get('x-request-id') ??
        response.headers.get('openai-processing-ms'),
    }
  }
}

export class OpenAICompatibleClient {
  readonly beta: {
    messages: {
      create: (
        params: BetaMessageStreamParams,
        options?: RequestOptions,
      ) => ProviderResponse<BetaMessage | Stream<BetaRawMessageStreamEvent>>
    }
  }

  constructor(
    private readonly config: {
      apiKey: string
      baseURL: string
      defaultHeaders?: Record<string, string>
      fetch?: typeof fetch
      fetchOptions?: RequestInit
      timeout?: number
    },
  ) {
    this.beta = {
      messages: {
        create: (params, options) =>
          new ProviderResponse(() => this.createChatCompletion(params, options)),
      },
    }
  }

  private async createChatCompletion(
    params: BetaMessageStreamParams,
    options?: RequestOptions,
  ): Promise<{
    data: BetaMessage | Stream<BetaRawMessageStreamEvent>
    response: Response
  }> {
    const response = await this.postChatCompletions(params, options)
    if (params.stream) {
      return {
        data: streamOpenAIResponse(response, params.model),
        response,
      }
    }

    const json = (await response.json()) as OpenAIChatCompletion
    return {
      data: completionToBetaMessage(json, params.model),
      response,
    }
  }

  private async postChatCompletions(
    params: BetaMessageStreamParams,
    options?: RequestOptions,
  ): Promise<Response> {
    const fetchImpl = this.config.fetch ?? globalThis.fetch
    const controller = new AbortController()
    const abort = () => controller.abort()
    const timeoutMs = options?.timeout ?? this.config.timeout
    const timeout =
      timeoutMs && timeoutMs > 0 ? setTimeout(abort, timeoutMs) : undefined
    options?.signal?.addEventListener('abort', abort, { once: true })

    try {
      const response = await fetchImpl(
        `${trimSlash(this.config.baseURL)}/chat/completions`,
        {
          ...this.config.fetchOptions,
          method: 'POST',
          signal: controller.signal,
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${this.config.apiKey}`,
            ...this.config.defaultHeaders,
            ...options?.headers,
          },
          body: JSON.stringify(toOpenAIRequest(params)),
        },
      )

      if (!response.ok) {
        throw await responseToAPIError(response)
      }
      return response
    } catch (error) {
      if (controller.signal.aborted || options?.signal?.aborted) {
        throw new APIUserAbortError()
      }
      if (error instanceof APIError) throw error
      if (error instanceof TypeError) {
        throw new APIConnectionError(error.message)
      }
      throw error
    } finally {
      if (timeout) clearTimeout(timeout)
      options?.signal?.removeEventListener('abort', abort)
    }
  }
}

export function resolveProviderConfig({
  apiKey,
  defaultHeaders,
  fetchOverride,
}: {
  apiKey?: string
  defaultHeaders?: Record<string, string>
  fetchOverride?: ClientOptions['fetch']
}): ConstructorParameters<typeof OpenAICompatibleClient>[0] {
  const resolvedApiKey =
    apiKey ?? process.env.OPEN_CODE_CLI_API_KEY ?? process.env.OPENAI_API_KEY
  if (!resolvedApiKey) {
    throw new APIError(
      'OPEN_CODE_CLI_API_KEY or OPENAI_API_KEY is required for OpenAI-compatible provider access',
    )
  }

  const openRouterReferer =
    process.env.OPEN_CODE_CLI_HTTP_REFERER ??
    process.env.OPEN_CODE_CLI_SITE_URL
  const openRouterTitle = process.env.OPEN_CODE_CLI_TITLE

  return {
    apiKey: resolvedApiKey,
    baseURL:
      process.env.OPEN_CODE_CLI_PROVIDER_BASE_URL ??
      process.env.OPEN_CODE_CLI_BASE_URL ??
      'https://openrouter.ai/api/v1',
    fetch: fetchOverride,
    timeout: parseInt(process.env.API_TIMEOUT_MS || String(600 * 1000), 10),
    defaultHeaders: {
      ...defaultHeaders,
      ...(openRouterReferer ? { 'HTTP-Referer': openRouterReferer } : {}),
      ...(openRouterTitle ? { 'X-Title': openRouterTitle } : {}),
    },
  }
}

function toOpenAIRequest(params: BetaMessageStreamParams): Record<string, unknown> {
  return {
    model: process.env.OPEN_CODE_CLI_MODEL ?? params.model,
    messages: [
      ...systemToMessages(params.system),
      ...params.messages.flatMap(messageToOpenAI),
    ],
    max_tokens: params.max_tokens,
    ...(params.temperature !== undefined && { temperature: params.temperature }),
    ...(params.stream && {
      stream: true,
      stream_options: { include_usage: true },
    }),
    ...(params.tools?.length
      ? {
          tools: params.tools.map(tool => ({
            type: 'function',
            function: {
              name: tool.name,
              description: tool.description ?? '',
              parameters: tool.input_schema ?? { type: 'object' },
            },
          })),
        }
      : {}),
    ...(params.tool_choice ? { tool_choice: mapToolChoice(params.tool_choice) } : {}),
    ...(params.output_config?.format && {
      response_format: params.output_config.format,
    }),
  }
}

function systemToMessages(system: BetaMessageStreamParams['system']): OpenAIMessage[] {
  if (!system) return []
  if (typeof system === 'string') return [{ role: 'system', content: system }]
  return [
    {
      role: 'system',
      content: system
        .map(block => ('text' in block ? String(block.text) : ''))
        .filter(Boolean)
        .join('\n\n'),
    },
  ]
}

function messageToOpenAI(message: MessageParam): OpenAIMessage[] {
  if (typeof message.content === 'string') {
    return [{ role: message.role, content: message.content } as OpenAIMessage]
  }

  if (message.role === 'assistant') {
    const text = message.content
      .filter(isTextBlock)
      .map(block => block.text)
      .join('')
    const toolCalls = message.content.filter(isToolUseBlock).map(block => ({
      id: block.id,
      type: 'function' as const,
      function: {
        name: block.name,
        arguments: JSON.stringify(block.input ?? {}),
      },
    }))
    return [
      {
        role: 'assistant',
        content: text || null,
        ...(toolCalls.length > 0 && { tool_calls: toolCalls }),
      },
    ]
  }

  const out: OpenAIMessage[] = []
  const contentParts: OpenAIContentPart[] = []
  for (const block of message.content) {
    if (isTextBlock(block)) {
      contentParts.push({ type: 'text', text: block.text })
    } else if (isImageBlock(block)) {
      const url =
        block.source.type === 'base64'
          ? `data:${block.source.media_type};base64,${block.source.data}`
          : block.source.url
      contentParts.push({ type: 'image_url', image_url: { url } })
    } else if (isToolResultBlock(block)) {
      if (contentParts.length > 0) {
        out.push({ role: 'user', content: contentParts.splice(0) })
      }
      out.push({
        role: 'tool',
        tool_call_id: block.tool_use_id,
        content: stringifyToolResult(block.content),
      })
    }
  }
  if (contentParts.length > 0 || out.length === 0) {
    out.push({ role: 'user', content: contentParts })
  }
  return out
}

function mapToolChoice(
  toolChoice: NonNullable<BetaMessageStreamParams['tool_choice']>,
): unknown {
  if (toolChoice.type === 'auto') return 'auto'
  if (toolChoice.type === 'tool') {
    return {
      type: 'function',
      function: { name: toolChoice.name },
    }
  }
  return undefined
}

function completionToBetaMessage(
  completion: OpenAIChatCompletion,
  fallbackModel: string,
): BetaMessage {
  const choice = completion.choices?.[0]
  const content: BetaContentBlock[] = []
  const text = choice?.message?.content
  if (text) {
    content.push({ type: 'text', text })
  }
  for (const toolCall of choice?.message?.tool_calls ?? []) {
    content.push(toolCallToBlock(toolCall))
  }
  return {
    id: completion.id ?? `msg_${randomUUID()}`,
    type: 'message',
    role: 'assistant',
    model: completion.model ?? fallbackModel,
    content,
    stop_reason: mapFinishReason(choice?.finish_reason),
    stop_sequence: null,
    usage: {
      input_tokens: completion.usage?.prompt_tokens ?? 0,
      output_tokens: completion.usage?.completion_tokens ?? 0,
    },
  }
}

function streamOpenAIResponse(
  response: Response,
  fallbackModel: string,
): Stream<BetaRawMessageStreamEvent> {
  const controller = new AbortController()
  async function* iterate(): AsyncGenerator<BetaRawMessageStreamEvent> {
    if (!response.body) {
      throw new APIConnectionError('Streaming response body is empty')
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let messageStarted = false
    let nextIndex = 0
    let textIndex: number | undefined
    const toolIndexes = new Map<number, number>()
    let lastFinishReason: string | null | undefined
    let usage: OpenAIStreamChunk['usage'] | undefined

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const events = buffer.split('\n\n')
        buffer = events.pop() ?? ''

        for (const event of events) {
          for (const chunk of parseSSEEvent(event)) {
            if (!messageStarted) {
              messageStarted = true
              yield {
                type: 'message_start',
                message: {
                  id: chunk.id ?? `msg_${randomUUID()}`,
                  type: 'message',
                  role: 'assistant',
                  content: [],
                  model: chunk.model ?? fallbackModel,
                  stop_reason: null,
                  stop_sequence: null,
                  usage: { input_tokens: 0, output_tokens: 0 },
                },
              }
            }

            usage = chunk.usage ?? usage
            const choice = chunk.choices?.[0]
            lastFinishReason = choice?.finish_reason ?? lastFinishReason
            const delta = choice?.delta
            if (delta?.content) {
              if (textIndex === undefined) {
                textIndex = nextIndex++
                yield {
                  type: 'content_block_start',
                  index: textIndex,
                  content_block: { type: 'text', text: '' },
                }
              }
              yield {
                type: 'content_block_delta',
                index: textIndex,
                delta: { type: 'text_delta', text: delta.content },
              }
            }

            for (const toolCall of delta?.tool_calls ?? []) {
              const callIndex = toolCall.index ?? 0
              let blockIndex = toolIndexes.get(callIndex)
              if (blockIndex === undefined) {
                blockIndex = nextIndex++
                toolIndexes.set(callIndex, blockIndex)
                yield {
                  type: 'content_block_start',
                  index: blockIndex,
                  content_block: {
                    type: 'tool_use',
                    id: toolCall.id ?? `call_${randomUUID()}`,
                    name: toolCall.function?.name ?? 'tool',
                    input: {},
                  },
                }
              }
              if (toolCall.function?.arguments) {
                yield {
                  type: 'content_block_delta',
                  index: blockIndex,
                  delta: {
                    type: 'input_json_delta',
                    partial_json: toolCall.function.arguments,
                  },
                }
              }
            }
          }
        }
      }
    } finally {
      reader.releaseLock()
    }

    if (textIndex !== undefined) {
      yield { type: 'content_block_stop', index: textIndex }
    }
    for (const index of toolIndexes.values()) {
      yield { type: 'content_block_stop', index }
    }
    yield {
      type: 'message_delta',
      delta: {
        stop_reason: mapFinishReason(lastFinishReason),
        stop_sequence: null,
      },
      usage: {
        input_tokens: usage?.prompt_tokens ?? 0,
        output_tokens: usage?.completion_tokens ?? 0,
      },
    }
    yield { type: 'message_stop' }
  }

  return {
    controller,
    [Symbol.asyncIterator]: iterate,
  }
}

function parseSSEEvent(event: string): OpenAIStreamChunk[] {
  const chunks: OpenAIStreamChunk[] = []
  for (const rawLine of event.split('\n')) {
    const line = rawLine.trim()
    if (!line.startsWith('data:')) continue
    const data = line.slice('data:'.length).trim()
    if (!data || data === '[DONE]') continue
    chunks.push(JSON.parse(data) as OpenAIStreamChunk)
  }
  return chunks
}

async function responseToAPIError(response: Response): Promise<APIError> {
  let body: unknown
  let message = response.statusText
  try {
    body = await response.json()
    message =
      ((body as { error?: { message?: string } }).error?.message ??
        (body as { message?: string }).message) ||
      message
  } catch {
    try {
      message = await response.text()
    } catch {
      // keep status text
    }
  }
  if (response.status === 408) {
    return new APIConnectionTimeoutError(message) as APIError
  }
  return new APIError(response.status, message, response.headers, body)
}

function toolCallToBlock(toolCall: OpenAIToolCall): ToolUseBlock {
  return {
    type: 'tool_use',
    id: toolCall.id,
    name: toolCall.function.name,
    input: parseToolArguments(toolCall.function.arguments),
  }
}

function parseToolArguments(input: string): unknown {
  if (!input) return {}
  try {
    return JSON.parse(input)
  } catch {
    return input
  }
}

function stringifyToolResult(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map(block => (isTextBlock(block) ? block.text : JSON.stringify(block)))
      .join('\n')
  }
  return content === undefined ? '' : JSON.stringify(content)
}

function mapFinishReason(reason: string | null | undefined): BetaStopReason {
  switch (reason) {
    case 'tool_calls':
      return 'tool_use'
    case 'length':
      return 'max_tokens'
    case 'content_filter':
      return 'refusal'
    case 'stop':
    case null:
    case undefined:
      return 'end_turn'
    default:
      return 'end_turn'
  }
}

function isTextBlock(block: ContentBlockParam): block is { type: 'text'; text: string } {
  return (block as { type?: unknown }).type === 'text'
}

function isImageBlock(
  block: ContentBlockParam,
): block is {
  type: 'image'
  source:
    | { type: 'base64'; media_type: string; data: string }
    | { type: 'url'; url: string }
} {
  return (block as { type?: unknown }).type === 'image'
}

function isToolUseBlock(block: ContentBlockParam): block is ToolUseBlock {
  return (block as { type?: unknown }).type === 'tool_use'
}

function isToolResultBlock(
  block: ContentBlockParam,
): block is { type: 'tool_result'; tool_use_id: string; content?: unknown } {
  return (block as { type?: unknown }).type === 'tool_result'
}

function trimSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value
}

export default OpenAICompatibleClient
