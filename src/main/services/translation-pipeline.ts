import type { TranslationUpdatedPayload } from '../../core/contracts/engine'
import type {
  ResolvedRuntimeConfig,
  TranscriptBlock,
  TranslationProvider,
  TranslationRuntimeConfig
} from '../../shared/api-types'

export interface TranslationProviderClient {
  translateText(input: {
    text: string
    sourceLanguage: string
    targetLanguage: string
  }): Promise<string>
}

export type TranslationPipelineOptions = {
  createProvider?: (config: TranslationRuntimeConfig) => TranslationProviderClient
}

export class TranslationPipeline {
  private readonly createProvider: (config: TranslationRuntimeConfig) => TranslationProviderClient

  constructor(options: TranslationPipelineOptions = {}) {
    this.createProvider = options.createProvider ?? createTranslationProviderFromEnvironment(process.env)
  }

  async translateBlock(input: {
    runtimeConfig: ResolvedRuntimeConfig
    block: TranscriptBlock
  }): Promise<TranslationUpdatedPayload> {
    const translationConfig = input.runtimeConfig.translationConfig

    if (!translationConfig) {
      throw new Error('Translation is not configured for this runtime')
    }

    const translatedText = await this.createProvider(translationConfig).translateText({
      text: input.block.text,
      sourceLanguage: translationConfig.sourceLanguage,
      targetLanguage: translationConfig.targetLanguage
    })

    return {
      blockId: input.block.id,
      translatedText
    }
  }
}

export type OpenAiCompatibleTranslationProviderOptions = {
  apiKey: string
  baseUrl?: string
  model?: string
  timeoutMs?: number
  fetchFn?: typeof fetch
}

export class OpenAiCompatibleTranslationProvider implements TranslationProviderClient {
  private readonly baseUrl: string
  private readonly model: string
  private readonly timeoutMs: number
  private readonly fetchFn: typeof fetch

  constructor(private readonly options: OpenAiCompatibleTranslationProviderOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? 'https://api.openai.com/v1')
    this.model = normalizeNonEmptyString(options.model, 'gpt-4o-mini')
    this.timeoutMs = options.timeoutMs ?? 10_000
    this.fetchFn = options.fetchFn ?? fetch
  }

  async translateText(input: {
    text: string
    sourceLanguage: string
    targetLanguage: string
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
          temperature: 0,
          messages: [
            {
              role: 'system',
              content:
                'You are a translation engine. Translate the user text faithfully. Return only the translated text without explanations or quotes.'
            },
            {
              role: 'user',
              content: `Source language: ${input.sourceLanguage}\nTarget language: ${input.targetLanguage}\nText:\n${input.text}`
            }
          ]
        }),
        signal: controller.signal
      })

      const payload = (await response.json()) as {
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

      if (!response.ok) {
        throw new Error(payload.error?.message ?? `Translation request failed with status ${response.status}`)
      }

      const translatedText = extractCompletionText(payload)

      if (!translatedText) {
        throw new Error('Translation provider returned an empty result')
      }

      return translatedText
    } catch (errorLike) {
      if (errorLike instanceof DOMException && errorLike.name === 'AbortError') {
        throw new Error('Translation request timed out')
      }

      throw errorLike
    } finally {
      clearTimeout(timeout)
    }
  }
}

export function createTranslationProviderFromEnvironment(
  env: NodeJS.ProcessEnv,
  options: {
    fetchFn?: typeof fetch
    timeoutMs?: number
  } = {}
): (config: TranslationRuntimeConfig) => TranslationProviderClient {
  const baseUrl = normalizeOptionalString(env.JUSTSAY_TRANSLATION_BASE_URL)
  const model = normalizeOptionalString(env.JUSTSAY_TRANSLATION_MODEL)

  return (config) => {
    switch (config.provider) {
      case 'openai-compatible':
        return new OpenAiCompatibleTranslationProvider({
          apiKey: config.credentials.translationApiKey,
          ...(baseUrl ? { baseUrl } : {}),
          ...(model ? { model } : {}),
          ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
          ...(options.fetchFn ? { fetchFn: options.fetchFn } : {})
        })
      default:
        return assertNever(config.provider)
    }
  }
}

function extractCompletionText(payload: {
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
}): string {
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

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '')
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized ? normalized : undefined
}

function normalizeNonEmptyString(value: string | undefined, fallback: string): string {
  const normalized = value?.trim()
  return normalized ? normalized : fallback
}

function assertNever(value: never): never {
  throw new Error(`Unsupported translation provider: ${String(value)}`)
}
