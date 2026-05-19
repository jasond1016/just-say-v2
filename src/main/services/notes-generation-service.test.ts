import { describe, expect, it, vi } from 'vitest'

import type { SavedTranscript, TranscriptNotesRuntimeConfig } from '../../shared/api-types'
import {
  DEFAULT_NOTES_TIMEOUT_MS,
  createNotesProviderFromEnvironment,
  NotesGenerationService,
  resolveNotesTimeoutMs
} from './notes-generation-service'

describe('NotesGenerationService', () => {
  it('maps structured provider output into persisted transcript notes', async () => {
    const service = new NotesGenerationService({
      now: () => 5000,
      createProvider: () => ({
        getModel: () => 'demo-model',
        generateJson: vi.fn(async () =>
          JSON.stringify({
            overview: 'Release review covered blockers.',
            decisions: [
              {
                summary: 'Ship after QA sign-off.',
                sourceBlockIds: ['block-1']
              }
            ],
            actionItems: [
              {
                task: 'Send the QA checklist.',
                owner: 'Mina',
                due: 'Friday',
                sourceBlockIds: ['block-2']
              }
            ],
            openQuestions: [
              {
                question: 'Do we need an extra dry run?',
                sourceBlockIds: ['block-2']
              }
            ]
          })
        )
      })
    })

    await expect(
      service.generate({
        transcript: createTranscript(),
        config: createConfig()
      })
    ).resolves.toEqual({
      transcriptId: 'tx-1',
      transcriptHash: service.computeTranscriptHash(createTranscript()),
      language: 'en',
      overview: 'Release review covered blockers.',
      decisions: [
        {
          summary: 'Ship after QA sign-off.',
          sourceRefs: [{ blockId: 'block-1', startedAt: 1000, endedAt: 1500 }]
        }
      ],
      actionItems: [
        {
          task: 'Send the QA checklist.',
          owner: 'Mina',
          due: 'Friday',
          sourceRefs: [{ blockId: 'block-2', startedAt: 1500, endedAt: 2200 }]
        }
      ],
      openQuestions: [
        {
          question: 'Do we need an extra dry run?',
          sourceRefs: [{ blockId: 'block-2', startedAt: 1500, endedAt: 2200 }]
        }
      ],
      generatedAt: 5000,
      promptVersion: 'notes-v1',
      provider: 'openai-compatible',
      model: 'demo-model'
    })
  })

  it('uses translation env defaults when endpoint and model are not set in the runtime config', async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                overview: 'summary',
                decisions: [],
                actionItems: [],
                openQuestions: []
              })
            }
          }
        ]
      })
    }))

    const createProvider = createNotesProviderFromEnvironment(
      {
        JUSTSAY_TRANSLATION_BASE_URL: 'https://example.test/v1/',
        JUSTSAY_TRANSLATION_MODEL: 'notes-model'
      },
      {
        fetchFn: fetchFn as unknown as typeof fetch
      }
    )

    const provider = createProvider(createConfig())

    await provider.generateJson({
      systemPrompt: 'system',
      userPrompt: 'user'
    })

    expect(fetchFn).toHaveBeenCalledWith(
      'https://example.test/v1/chat/completions',
      expect.objectContaining({
        body: expect.stringContaining('"model":"notes-model"'),
        signal: expect.any(AbortSignal)
      })
    )
  })

  it('uses a longer notes-specific timeout by default', () => {
    expect(resolveNotesTimeoutMs({})).toBe(DEFAULT_NOTES_TIMEOUT_MS)
  })

  it('supports overriding the notes timeout from the environment', () => {
    expect(resolveNotesTimeoutMs({ JUSTSAY_NOTES_TIMEOUT_MS: '90000' })).toBe(90_000)
  })
})

function createTranscript(): SavedTranscript {
  return {
    id: 'tx-1',
    mode: 'meeting',
    title: 'Weekly sync',
    startedAt: 1000,
    endedAt: 2500,
    plainText: 'Release review covered blockers. Mina will send the QA checklist.',
    blocks: [
      {
        id: 'block-1',
        source: 'system',
        text: 'Release review covered blockers.',
        startedAt: 1000,
        endedAt: 1500
      },
      {
        id: 'block-2',
        source: 'system',
        text: 'Mina will send the QA checklist.',
        startedAt: 1500,
        endedAt: 2200
      }
    ],
    metadata: {
      engineProfileId: 'local-fast',
      runtimeFamilyId: 'sensevoice',
      modelIdentifier: 'iic/SenseVoiceSmall',
      deploymentMode: 'managed-local',
      includeMicrophone: true,
      translationEnabled: false
    }
  }
}

function createConfig(): TranscriptNotesRuntimeConfig {
  return {
    provider: 'openai-compatible',
    language: 'en',
    credentials: {
      translationApiKey: 'translation-secret'
    }
  }
}
