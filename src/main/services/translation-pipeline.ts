import type { TranslationUpdatedPayload } from '../../core/contracts/engine'
import type {
  ResolvedRuntimeConfig,
  TranscriptBlock,
  TranslationRuntimeConfig
} from '../../shared/api-types'
import { isDeepSeekChatEndpoint } from '../../shared/deepseek-chat'
import {
  OpenAiCompatibleChatClient,
  normalizeOptionalString,
  type OpenAiCompatibleThinking
} from './openai-compatible-chat'

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
  apiKey?: string
  baseUrl?: string
  model?: string
  discoverModel?: boolean
  timeoutMs?: number
  fetchFn?: typeof fetch
  thinkingEnabled?: boolean
}

const discoveredModelIds = new Map<string, string>()

export class OpenAiCompatibleTranslationProvider implements TranslationProviderClient {
  private readonly client: OpenAiCompatibleChatClient

  constructor(private readonly options: OpenAiCompatibleTranslationProviderOptions) {
    const thinking = resolveTranslationThinking(options.baseUrl, options.thinkingEnabled)

    this.client = new OpenAiCompatibleChatClient({
      ...(options.apiKey ? { apiKey: options.apiKey } : {}),
      ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
      ...(options.model ? { model: options.model } : {}),
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      ...(options.fetchFn ? { fetchFn: options.fetchFn } : {}),
      ...(thinking ? { thinking } : {})
    })
  }

  async translateText(input: {
    text: string
    sourceLanguage: string
    targetLanguage: string
  }): Promise<string> {
    const thinking = resolveTranslationThinking(this.options.baseUrl, this.options.thinkingEnabled)
    const client = this.options.discoverModel
      ? new OpenAiCompatibleChatClient({
          ...(this.options.apiKey ? { apiKey: this.options.apiKey } : {}),
          ...(this.options.baseUrl ? { baseUrl: this.options.baseUrl } : {}),
          model: await discoverLoadedModel(this.options.baseUrl, this.options.apiKey, this.options.fetchFn ?? fetch),
          ...(this.options.timeoutMs !== undefined ? { timeoutMs: this.options.timeoutMs } : {}),
          ...(this.options.fetchFn ? { fetchFn: this.options.fetchFn } : {}),
          ...(thinking ? { thinking } : {})
        })
      : this.client

    return client.complete({
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

  return (config) =>
    new OpenAiCompatibleTranslationProvider({
      ...(config.credentials ? { apiKey: config.credentials.translationApiKey } : {}),
      ...(config.endpoint ? { baseUrl: config.endpoint } : baseUrl ? { baseUrl } : {}),
      ...(config.model ? { model: config.model } : model ? { model } : {}),
      ...(config.discoverModel ? { discoverModel: true } : {}),
      ...(config.thinkingEnabled ? { thinkingEnabled: true } : {}),
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      ...(options.fetchFn ? { fetchFn: options.fetchFn } : {})
    })
}

async function discoverLoadedModel(
  baseUrl: string | undefined,
  apiKey: string | undefined,
  fetchFn: typeof fetch
): Promise<string> {
  const normalized = (baseUrl ?? 'https://api.openai.com/v1').replace(/\/+$/, '')
  const cached = discoveredModelIds.get(normalized)

  if (cached) {
    return cached
  }

  const response = apiKey
    ? await fetchFn(`${normalized}/models`, {
        headers: {
          Authorization: `Bearer ${apiKey}`
        }
      })
    : await fetchFn(`${normalized}/models`)
  const payload = (await response.json()) as { data?: Array<{ id?: string }> }
  const id = payload.data?.[0]?.id?.trim()

  if (!response.ok || !id) {
    throw new Error('Index-Translate-2B server did not report a loaded model')
  }

  discoveredModelIds.set(normalized, id)
  return id
}

function resolveTranslationThinking(
  baseUrl: string | undefined,
  thinkingEnabled: boolean | undefined
): OpenAiCompatibleThinking | undefined {
  if (!isDeepSeekChatEndpoint(baseUrl)) {
    return undefined
  }

  return {
    type: thinkingEnabled === true ? 'enabled' : 'disabled'
  }
}
