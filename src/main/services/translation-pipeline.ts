import type { TranslationUpdatedPayload } from '../../core/contracts/engine'
import type {
  ResolvedRuntimeConfig,
  TranscriptBlock,
  TranslationProvider,
  TranslationRuntimeConfig
} from '../../shared/api-types'
import { OpenAiCompatibleChatClient, normalizeOptionalString } from './openai-compatible-chat'

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
  private readonly client: OpenAiCompatibleChatClient

  constructor(options: OpenAiCompatibleTranslationProviderOptions) {
    this.client = new OpenAiCompatibleChatClient({
      apiKey: options.apiKey,
      ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
      ...(options.model ? { model: options.model } : {}),
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      ...(options.fetchFn ? { fetchFn: options.fetchFn } : {})
    })
  }

  async translateText(input: {
    text: string
    sourceLanguage: string
    targetLanguage: string
  }): Promise<string> {
    return this.client.complete({
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
    })
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
          ...(config.endpoint ? { baseUrl: config.endpoint } : baseUrl ? { baseUrl } : {}),
          ...(config.model ? { model: config.model } : model ? { model } : {}),
          ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
          ...(options.fetchFn ? { fetchFn: options.fetchFn } : {})
        })
      default:
        return assertNever(config.provider)
    }
  }
}

function assertNever(value: never): never {
  throw new Error(`Unsupported translation provider: ${String(value)}`)
}
