import { describe, expect, it, vi } from 'vitest'

import { profileCatalog } from '../../core/settings/profile-catalog'
import type { ResolvedRuntimeConfig } from '../../shared/api-types'
import {
  createTranslationProviderFromEnvironment,
  OpenAiCompatibleTranslationProvider,
  TranslationPipeline
} from './translation-pipeline'

describe('TranslationPipeline', () => {
  it('translates a committed block through the configured provider', async () => {
    const pipeline = new TranslationPipeline({
      createProvider: () => ({
        async translateText() {
          return 'こんにちは世界'
        }
      })
    })

    await expect(
      pipeline.translateBlock({
        runtimeConfig: createRuntimeConfig(),
        block: {
          id: 'block-1',
          source: 'microphone',
          text: 'hello world',
          startedAt: 1000,
          endedAt: 1200
        }
      })
    ).resolves.toEqual({
      blockId: 'block-1',
      translatedText: 'こんにちは世界'
    })
  })

  it('uses environment defaults for openai-compatible providers', async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: 'translated from env'
            }
          }
        ]
      })
    }))

    const createProvider = createTranslationProviderFromEnvironment(
      {
        JUSTSAY_TRANSLATION_BASE_URL: 'https://example.test/v1/',
        JUSTSAY_TRANSLATION_MODEL: 'demo-model'
      },
      {
        fetchFn: fetchFn as unknown as typeof fetch,
        timeoutMs: 2500
      }
    )
    const provider = createProvider(createRuntimeConfig().translationConfig!)

    await expect(
      provider.translateText({
        text: 'hello world',
        sourceLanguage: 'auto',
        targetLanguage: 'ja'
      })
    ).resolves.toBe('translated from env')

    expect(fetchFn).toHaveBeenCalledWith(
      'https://example.test/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"model":"demo-model"')
      })
    )
  })

  it('prefers runtime endpoint and model over environment defaults', async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: 'translated from runtime config'
            }
          }
        ]
      })
    }))

    const createProvider = createTranslationProviderFromEnvironment(
      {
        JUSTSAY_TRANSLATION_BASE_URL: 'https://env.example/v1',
        JUSTSAY_TRANSLATION_MODEL: 'env-model'
      },
      {
        fetchFn: fetchFn as unknown as typeof fetch
      }
    )
    const provider = createProvider({
      ...createRuntimeConfig().translationConfig!,
      endpoint: 'https://runtime.example/v1',
      model: 'runtime-model'
    })

    await provider.translateText({
      text: 'hello world',
      sourceLanguage: 'auto',
      targetLanguage: 'ja'
    })

    expect(fetchFn).toHaveBeenCalledWith(
      'https://runtime.example/v1/chat/completions',
      expect.objectContaining({
        body: expect.stringContaining('"model":"runtime-model"')
      })
    )
  })
})

describe('OpenAiCompatibleTranslationProvider', () => {
  it('extracts text from structured content arrays', async () => {
    const provider = new OpenAiCompatibleTranslationProvider({
      apiKey: 'translation-secret',
      fetchFn: (async () => ({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: [
                  {
                    type: 'output_text',
                    text: '你好'
                  },
                  {
                    type: 'output_text',
                    text: '世界'
                  }
                ]
              }
            }
          ]
        })
      })) as unknown as typeof fetch
    })

    await expect(
      provider.translateText({
        text: 'hello world',
        sourceLanguage: 'auto',
        targetLanguage: 'zh'
      })
    ).resolves.toBe('你好世界')
  })
})

function createRuntimeConfig(): ResolvedRuntimeConfig {
  return {
    engineProfile: profileCatalog[0]!,
    engineConfig: {
      mode: 'meeting',
      profileId: 'local-fast',
      preset: 'local-fast',
      language: 'auto',
      diagnosticsEnabled: true,
      experimentalFlags: []
    },
    translationConfig: {
      provider: 'openai-compatible',
      targetLanguage: 'ja',
      sourceLanguage: 'auto',
      credentials: {
        translationApiKey: 'translation-secret'
      }
    },
    captureConfig: {
      sampleRate: 16000,
      chunkMs: 100
    },
    outputConfig: {
      method: 'simulate_input'
    }
  }
}
