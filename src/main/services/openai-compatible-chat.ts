export type OpenAiCompatibleChatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type OpenAiCompatibleChatClientOptions = {
  apiKey: string
  baseUrl?: string
  model?: string
  timeoutMs?: number
  fetchFn?: typeof fetch
}

export class OpenAiCompatibleChatClient {
  private readonly baseUrl: string
  private readonly model: string
  private readonly timeoutMs: number
  private readonly fetchFn: typeof fetch

  constructor(private readonly options: OpenAiCompatibleChatClientOptions) {
    this.baseUrl = normalizeOpenAiCompatibleBaseUrl(options.baseUrl ?? 'https://api.openai.com/v1')
    this.model = normalizeNonEmptyString(options.model, 'gpt-4o-mini')
    this.timeoutMs = options.timeoutMs ?? 10_000
    this.fetchFn = options.fetchFn ?? fetch
  }

  getModel(): string {
    return this.model
  }

  async complete(input: {
    messages: OpenAiCompatibleChatMessage[]
    temperature?: number
    responseFormat?: 'json_object'
  }): Promise<string> {
    const controller = new AbortController()
    const timeout = setTimeout(() => {
      controller.abort()
    }, this.timeoutMs)

    try {
      const response = await this.fetchFn(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: this.model,
          temperature: input.temperature ?? 0,
          messages: input.messages,
          ...(input.responseFormat ? { response_format: { type: input.responseFormat } } : {})
        }),
        signal: controller.signal
      })

      const payload = (await response.json()) as OpenAiCompatibleChatPayload

      if (!response.ok) {
        throw new Error(payload.error?.message ?? `OpenAI-compatible request failed with status ${response.status}`)
      }

      const content = extractOpenAiCompatibleCompletionText(payload)

      if (!content) {
        throw new Error('OpenAI-compatible provider returned an empty result')
      }

      return content
    } catch (errorLike) {
      if (errorLike instanceof Error && errorLike.name === 'AbortError') {
        throw new Error('OpenAI-compatible request timed out')
      }

      throw errorLike
    } finally {
      clearTimeout(timeout)
    }
  }
}

type OpenAiCompatibleChatPayload = {
  choices?: Array<{
    message?: {
      content?:
        | string
        | Array<{
            type?: string
            text?: string
          }>
    }
  }>
  error?: {
    message?: string
  }
}

export function extractOpenAiCompatibleCompletionText(payload: OpenAiCompatibleChatPayload): string {
  const content = payload.choices?.[0]?.message?.content

  if (typeof content === 'string') {
    return content.trim()
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part.text === 'string' ? part.text : ''))
      .join('')
      .trim()
  }

  return ''
}

export function normalizeOpenAiCompatibleBaseUrl(value: string): string {
  return value.replace(/\/+$/, '')
}

export function normalizeOptionalString(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized ? normalized : undefined
}

function normalizeNonEmptyString(value: string | undefined, fallback: string): string {
  const normalized = value?.trim()
  return normalized ? normalized : fallback
}
