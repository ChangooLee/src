import { randomUUID } from 'crypto'
import {
  APIConnectionError,
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
export { default } from './providerTypes.js'

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

type ChatCreate = {
  (
    params: BetaMessageStreamParams & { stream: true },
    options?: RequestOptions,
  ): ProviderResponse<Stream<BetaRawMessageStreamEvent>>
  (
    params: BetaMessageStreamParams & { stream?: false | undefined },
    options?: RequestOptions,
  ): ProviderResponse<BetaMessage>
  (
    params: BetaMessageStreamParams,
    options?: RequestOptions,
  ): ProviderResponse<BetaMessage | Stream<BetaRawMessageStreamEvent>>
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
      request_id: response.headers.get('x-request-id'),
    }
  }
}

export class OpenAICompatibleClient {
  readonly beta: {
    messages: {
      create: ChatCreate
    }
  }

  constructor(
    private readonly config: {
      apiKey: string
      baseURL: string
      defaultHeaders?: Record<string, string>
      fetch?: typeof fetch
      timeout?: number
    },
  ) {
    this.beta = {
      messages: {
        create: (params, options) =>
          new ProviderResponse(() => this.createChatCompletion(params, options)),
      } as { create: ChatCreate },
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
  const resolvedApiKey = apiKey ?? process.env.OPEN_CODE_CLI_API_KEY
  if (!resolvedApiKey) {
    throw new APIError(
      'OPEN_CODE_CLI_API_KEY is required for OpenAI-compatible provider access',
    )
  }

  const openRouterReferer =
    process.env.OPEN_CODE_CLI_HTTP_REFERER ??
    process.env.OPEN_CODE_CLI_SITE_URL
  const openRouterTitle = process.env.OPEN_CODE_CLI_TITLE

  return {
    apiKey: resolvedApiKey,
    baseURL:
      process.env.OPEN_CODE_CLI_BASE_URL ?? 'https://openrouter.ai/api/v1',
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
  constructor(private readonly run: () => Promise<{ data: T; response: Response }>) {}

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
        response.headers.get('openai-processing-ms') ??
        null,
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
      const response = await fetchImpl(`${trimSlash(this.config.baseURL)}/chat/completions`, {
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
      })

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
  const resolvedApiKey = apiKey ?? process.env.OPEN_CODE_CLI_API_KEY
  if (!resolvedApiKey) {
    throw new APIError(
      'OPEN_CODE_CLI_API_KEY is required for OpenAI-compatible provider access',
    )
  }

  const openRouterReferer =
    process.env.OPEN_CODE_CLI_HTTP_REFERER ??
    process.env.OPEN_CODE_CLI_SITE_URL
  const openRouterTitle = process.env.OPEN_CODE_CLI_TITLE

  return {
    apiKey: resolvedApiKey,
    baseURL:
      process.env.OPEN_CODE_CLI_BASE_URL ?? 'https://openrouter.ai/api/v1',
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
  const messages = [
    ...systemToMessages(params.system),
    ...params.messages.flatMap(messageToOpenAI),
  ]

  return {
    model: process.env.OPEN_CODE_CLI_MODEL ?? params.model,
    messages,
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
export type ClientOptions = {
  defaultHeaders?: Record<string, string>
  maxRetries?: number
  timeout?: number
  dangerouslyAllowBrowser?: boolean
  fetch?: typeof fetch
  fetchOptions?: RequestInit
}

export class APIError extends Error {
  status?: number
  headers?: Headers
  error?: unknown

  constructor(message: string, status?: number, error?: unknown, headers?: Headers) {
    super(message)
    this.name = 'APIError'
    this.status = status
    this.error = error
    this.headers = headers
  }
}

export class APIConnectionError extends Error {
  constructor(message = 'API connection error') {
    super(message)
    this.name = 'APIConnectionError'
  }
}

export class APIConnectionTimeoutError extends APIConnectionError {
  constructor(message = 'API connection timed out') {
    super(message)
    this.name = 'APIConnectionTimeoutError'
  }
}

export class APIUserAbortError extends Error {
  constructor(message = 'Request aborted') {
    super(message)
    this.name = 'APIUserAbortError'
  }
}

export type Stream<T> = AsyncIterable<T> & {
  controller?: AbortController
}

export type BetaUsage = {
  input_tokens?: number
  output_tokens?: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
  server_tool_use?: Record<string, unknown>
  service_tier?: string
}

export type BetaMessageDeltaUsage = Partial<BetaUsage>
export type BetaStopReason =
  | 'end_turn'
  | 'max_tokens'
  | 'stop_sequence'
  | 'tool_use'
  | 'pause_turn'
  | 'refusal'
  | 'model_context_window_exceeded'
  | null

export type TextBlockParam = { type: 'text'; text: string; [key: string]: unknown }
export type ThinkingBlock = { type: 'thinking'; thinking: string; signature?: string }
export type ThinkingBlockParam = ThinkingBlock
export type RedactedThinkingBlock = { type: 'redacted_thinking'; data?: string }
export type RedactedThinkingBlockParam = RedactedThinkingBlock
export type Base64ImageSource = {
  type: 'base64'
  media_type: string
  data: string
}
export type ImageBlockParam = {
  type: 'image'
  source: Base64ImageSource | Record<string, unknown>
}
export type BetaImageBlockParam = ImageBlockParam
export type BetaRequestDocumentBlock = {
  type: 'document'
  source?: Record<string, unknown>
  [key: string]: unknown
}

export type ToolUseBlock = {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown> | string
}
export type ToolUseBlockParam = ToolUseBlock
export type ToolResultBlockParam = {
  type: 'tool_result'
  tool_use_id: string
  content?: string | ContentBlockParam[]
  is_error?: boolean
  [key: string]: unknown
}

export type ContentBlock =
  | TextBlockParam
  | ThinkingBlock
  | RedactedThinkingBlock
  | ToolUseBlock
  | ToolResultBlockParam
  | ImageBlockParam
  | (Record<string, unknown> & { type: string })
export type ContentBlockParam = ContentBlock
export type BetaContentBlock = ContentBlock
export type BetaContentBlockParam = ContentBlockParam
export type BetaThinkingBlock = ThinkingBlock
export type BetaRedactedThinkingBlock = RedactedThinkingBlock
export type BetaToolUseBlock = ToolUseBlock

export type MessageParam = {
  role: 'user' | 'assistant'
  content: string | ContentBlockParam[]
}
export type BetaMessageParam = MessageParam

export type BetaMessage = {
  id?: string
  type?: 'message'
  role: 'assistant'
  content: BetaContentBlock[]
  model?: string
  stop_reason?: BetaStopReason
  stop_sequence?: string | null
  usage?: BetaUsage
}

export type BetaTool = {
  name: string
  description?: string
  input_schema: Anthropic.Tool.InputSchema
  [key: string]: unknown
}
export type BetaToolUnion = BetaTool
export type BetaToolChoiceAuto = { type: 'auto'; [key: string]: unknown }
export type BetaToolChoiceTool = { type: 'tool'; name: string; [key: string]: unknown }
export type BetaJSONOutputFormat = Record<string, unknown>
export type BetaOutputConfig = Record<string, unknown>

export type BetaMessageStreamParams = {
  model: string
  messages: MessageParam[]
  system?: string | TextBlockParam[]
  tools?: BetaToolUnion[]
  tool_choice?: BetaToolChoiceAuto | BetaToolChoiceTool
  max_tokens: number
  temperature?: number
  stream?: boolean
  thinking?: { type: 'disabled' | 'enabled' | 'adaptive'; budget_tokens?: number }
  metadata?: Record<string, unknown>
  [key: string]: unknown
}

export type BetaRawMessageStreamEvent =
  | { type: 'message_start'; message: BetaMessage }
  | { type: 'content_block_start'; index: number; content_block: BetaContentBlock }
  | {
      type: 'content_block_delta'
      index: number
      delta:
        | { type: 'text_delta'; text: string }
        | { type: 'input_json_delta'; partial_json: string }
        | { type: 'thinking_delta'; thinking: string }
        | { type: 'signature_delta'; signature: string }
        | { type: 'citations_delta'; [key: string]: unknown }
        | (Record<string, unknown> & { type: string })
    }
  | { type: 'content_block_stop'; index: number }
  | {
      type: 'message_delta'
      delta: { stop_reason: BetaStopReason; stop_sequence?: string | null }
      usage: BetaMessageDeltaUsage
    }
  | { type: 'message_stop' }
  | (Record<string, unknown> & { type: string })

export namespace Anthropic {
  export namespace Tool {
    export type InputSchema = {
      type?: string
      properties?: Record<string, unknown>
      required?: string[]
      additionalProperties?: boolean
      [key: string]: unknown
    }
  }
}

type OpenAIMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?: string | null
  tool_call_id?: string
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
}

type OpenAIChatChoice = {
  message?: {
    content?: string | null
    tool_calls?: Array<{
      id: string
      type: 'function'
      function: { name: string; arguments: string }
    }>
  }
  delta?: {
    content?: string | null
    tool_calls?: Array<{
      index?: number
      id?: string
      type?: 'function'
      function?: { name?: string; arguments?: string }
    }>
  }
  finish_reason?: string | null
}

type OpenAIChatResponse = {
  id?: string
  model?: string
  choices?: OpenAIChatChoice[]
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  }
}

function usageFromOpenAI(usage?: OpenAIChatResponse['usage']): BetaUsage {
  return {
    input_tokens: usage?.prompt_tokens ?? 0,
    output_tokens: usage?.completion_tokens ?? 0,
  }
}

function contentToText(content: string | ContentBlockParam[] | undefined): string {
  if (content === undefined) return ''
  if (typeof content === 'string') return content
  return content
    .map(block => {
      if (block.type === 'text' && 'text' in block) return String(block.text)
      if (block.type === 'tool_result' && 'content' in block) {
        return typeof block.content === 'string'
          ? block.content
          : contentToText(block.content as ContentBlockParam[])
      }
      return ''
    })
    .filter(Boolean)
    .join('\n')
}

function toOpenAIMessages(params: BetaMessageStreamParams): OpenAIMessage[] {
  const messages: OpenAIMessage[] = []
  if (params.system) {
    messages.push({
      role: 'system',
      content:
        typeof params.system === 'string'
          ? params.system
          : params.system.map(block => block.text).join('\n\n'),
    })
  }

  for (const message of params.messages) {
    if (message.role === 'user') {
      const toolResults = Array.isArray(message.content)
        ? message.content.filter(block => block.type === 'tool_result')
        : []
      if (toolResults.length > 0) {
        for (const block of toolResults as ToolResultBlockParam[]) {
          messages.push({
            role: 'tool',
            tool_call_id: block.tool_use_id,
            content: contentToText(block.content as string | ContentBlockParam[]),
          })
        }
        const text = contentToText(
          (message.content as ContentBlockParam[]).filter(
            block => block.type !== 'tool_result',
          ),
        )
        if (text) messages.push({ role: 'user', content: text })
      } else {
        messages.push({ role: 'user', content: contentToText(message.content) })
      }
      continue
    }

    const content = Array.isArray(message.content) ? message.content : []
    const toolUses = content.filter(block => block.type === 'tool_use') as ToolUseBlock[]
    messages.push({
      role: 'assistant',
      content: contentToText(content.filter(block => block.type !== 'tool_use')),
      ...(toolUses.length > 0 && {
        tool_calls: toolUses.map(block => ({
          id: block.id,
          type: 'function' as const,
          function: {
            name: block.name,
            arguments:
              typeof block.input === 'string'
                ? block.input
                : JSON.stringify(block.input ?? {}),
          },
        })),
      }),
    })
  }
  return messages
}

function toOpenAITools(tools?: BetaToolUnion[]) {
  return tools?.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    },
  }))
}

function stopReasonFromOpenAI(reason?: string | null): BetaStopReason {
  if (reason === 'length') return 'max_tokens'
  if (reason === 'tool_calls') return 'tool_use'
  if (reason === 'content_filter') return 'refusal'
  return 'end_turn'
}

function messageFromOpenAI(response: OpenAIChatResponse): BetaMessage {
  const choice = response.choices?.[0]
  const content: BetaContentBlock[] = []
  const text = choice?.message?.content ?? ''
  if (text) content.push({ type: 'text', text })
  for (const call of choice?.message?.tool_calls ?? []) {
    content.push({
      type: 'tool_use',
      id: call.id,
      name: call.function.name,
      input: safeJson(call.function.arguments),
    })
  }
  return {
    id: response.id,
    type: 'message',
    role: 'assistant',
    model: response.model,
    content,
    stop_reason: stopReasonFromOpenAI(choice?.finish_reason),
    usage: usageFromOpenAI(response.usage),
  }
}

function safeJson(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value || '{}')
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

async function parseError(response: Response): Promise<APIError> {
  const text = await response.text().catch(() => response.statusText)
  let body: unknown = text
  try {
    body = JSON.parse(text)
  } catch {
    // Keep raw text.
  }
  return new APIError(
    typeof body === 'object' && body && 'error' in body
      ? JSON.stringify(body)
      : text || response.statusText,
    response.status,
    body,
    response.headers,
  )
}

async function* streamEvents(
  response: Response,
  controller: AbortController,
): AsyncGenerator<BetaRawMessageStreamEvent> {
  const usage: BetaUsage = { input_tokens: 0, output_tokens: 0 }
  const stream = response.body
  if (!stream) throw new APIConnectionError('Streaming response has no body')

  yield {
    type: 'message_start',
    message: {
      type: 'message',
      role: 'assistant',
      content: [],
      usage,
      stop_reason: null,
    },
  }

  let textStarted = false
  let textIndex = 0
  const toolIndexes = new Map<number, number>()
  const decoder = new TextDecoder()
  let buffer = ''

  for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) {
    if (controller.signal.aborted) throw new APIUserAbortError()
    buffer += decoder.decode(chunk, { stream: true })
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (!data || data === '[DONE]') continue
      const parsed = JSON.parse(data) as OpenAIChatResponse
      const choice = parsed.choices?.[0]
      if (!choice) continue
      const delta = choice.delta
      if (delta?.content) {
        if (!textStarted) {
          textStarted = true
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
        const openAIIndex = toolCall.index ?? 0
        let blockIndex = toolIndexes.get(openAIIndex)
        if (blockIndex === undefined) {
          blockIndex = textStarted ? toolIndexes.size + 1 : toolIndexes.size
          toolIndexes.set(openAIIndex, blockIndex)
          yield {
            type: 'content_block_start',
            index: blockIndex,
            content_block: {
              type: 'tool_use',
              id: toolCall.id ?? `toolu_${openAIIndex}`,
              name: toolCall.function?.name ?? 'tool',
              input: '',
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
      if (choice.finish_reason) {
        if (textStarted) yield { type: 'content_block_stop', index: textIndex }
        for (const blockIndex of toolIndexes.values()) {
          yield { type: 'content_block_stop', index: blockIndex }
        }
        yield {
          type: 'message_delta',
          delta: {
            stop_reason: stopReasonFromOpenAI(choice.finish_reason),
            stop_sequence: null,
          },
          usage,
        }
        yield { type: 'message_stop' }
      }
    }
  }
}

export default class OpenAICompatibleClient {
  beta = {
    messages: {
      create: (
        params: BetaMessageStreamParams,
        requestOptions?: {
          signal?: AbortSignal
          timeout?: number
          headers?: Record<string, string>
        },
      ) => {
        const execute = async () => {
          const response = await this.request(params, requestOptions)
          if (!response.ok) throw await parseError(response)
          if (params.stream) {
            const controller = new AbortController()
            const data = streamEvents(response, controller) as Stream<BetaRawMessageStreamEvent>
            data.controller = controller
            return { data, response, request_id: response.headers.get('x-request-id') }
          }
          const json = (await response.json()) as OpenAIChatResponse
          return {
            data: messageFromOpenAI(json),
            response,
            request_id: response.headers.get('x-request-id'),
          }
        }

        if (params.stream) {
          return { withResponse: execute }
        }

        return execute().then(result => result.data)
      },
    },
  }

  constructor(
    private readonly options: ClientOptions & {
      apiKey: string
      baseURL: string
      defaultHeaders?: Record<string, string>
    },
  ) {}

  private async request(
    params: BetaMessageStreamParams,
    requestOptions?: {
      signal?: AbortSignal
      timeout?: number
      headers?: Record<string, string>
    },
  ): Promise<Response> {
    const fetchImpl = this.options.fetch ?? globalThis.fetch
    const headers = new Headers({
      Authorization: `Bearer ${this.options.apiKey}`,
      'Content-Type': 'application/json',
      ...this.options.defaultHeaders,
      ...requestOptions?.headers,
    })
    const tools = toOpenAITools(params.tools)
    const body = {
      model: params.model,
      messages: toOpenAIMessages(params),
      max_tokens: params.max_tokens,
      temperature: params.temperature,
      stream: params.stream,
      ...(tools && tools.length > 0 && { tools }),
      ...(params.tool_choice?.type === 'tool' && {
        tool_choice: {
          type: 'function',
          function: { name: params.tool_choice.name },
        },
      }),
      ...(params.tool_choice?.type === 'auto' && { tool_choice: 'auto' }),
      ...(params.output_config?.format && {
        response_format: params.output_config.format,
      }),
    }

    try {
      return await fetchImpl(`${this.options.baseURL.replace(/\/$/, '')}/chat/completions`, {
        ...this.options.fetchOptions,
        method: 'POST',
        signal: requestOptions?.signal,
        headers,
        body: JSON.stringify(body),
      })
    } catch (error) {
      if (requestOptions?.signal?.aborted) throw new APIUserAbortError()
      throw new APIConnectionError(error instanceof Error ? error.message : String(error))
    }
  }
}
