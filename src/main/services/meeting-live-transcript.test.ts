import { describe, expect, it, vi } from 'vitest'

import type { ResolvedRuntimeConfig } from '../../shared/api-types'
import { profileCatalog } from '../../core/settings/profile-catalog'
import { MeetingLiveTranscript } from './meeting-live-transcript'

describe('MeetingLiveTranscript', () => {
  it('returns false for unhandled recognition events', () => {
    const live = new MeetingLiveTranscript()
    live.reset('meeting-1', createRuntimeConfig())

    expect(live.handleRecognitionEvent({ type: 'session-ready' })).toBe(false)
    expect(live.handleRecognitionEvent({ type: 'session-ended' })).toBe(false)
  })

  it('applies draft then block and exposes snapshot fields', () => {
    const onChanged = vi.fn()
    const live = new MeetingLiveTranscript({ onChanged })
    live.reset('meeting-1', createRuntimeConfig())

    expect(
      live.handleRecognitionEvent({
        type: 'draft-updated',
        payload: {
          blockId: 'b1',
          source: 'system',
          stableText: 'hello',
          previewText: ' world',
          startedAt: 1,
          updatedAt: 2
        }
      })
    ).toBe(true)

    expect(
      live.handleRecognitionEvent({
        type: 'block-committed',
        payload: {
          block: {
            id: 'b1',
            text: 'hello world',
            source: 'system',
            startedAt: 1,
            endedAt: 2
          }
        }
      })
    ).toBe(true)

    expect(onChanged).toHaveBeenCalledTimes(2)
    const fields = live.getSnapshotFields()
    expect(fields.translationEnabled).toBe(false)
    expect(fields.transcript.committedBlocks).toHaveLength(1)
    expect(fields.transcript.committedBlocks[0]?.text).toBe('hello world')

    const saved = live.buildSavedTranscriptInput()
    expect(saved.plainText).toContain('hello world')
    expect(saved.blocks).toHaveLength(1)
  })

  it('awaits pending translations started after block commit', async () => {
    let resolveTranslation: ((value: { blockId: string; translatedText: string }) => void) | undefined
    const translationPipeline = {
      translateBlock: vi.fn(
        () =>
          new Promise<{ blockId: string; translatedText: string }>((resolve) => {
            resolveTranslation = resolve
          })
      )
    }
    const live = new MeetingLiveTranscript({
      translationPipeline
    })
    live.reset('meeting-1', createRuntimeConfig({ withTranslation: true }))

    live.handleRecognitionEvent({
      type: 'block-committed',
      payload: {
        block: {
          id: 'b1',
          text: 'hello',
          source: 'system',
          startedAt: 1,
          endedAt: 2
        }
      }
    })

    expect(translationPipeline.translateBlock).toHaveBeenCalledTimes(1)

    const pending = live.awaitPendingTranslations()
    resolveTranslation?.({ blockId: 'b1', translatedText: '你好' })
    await pending

    const saved = live.buildSavedTranscriptInput()
    expect(saved.translatedPlainText).toContain('你好')
  })

  it('clear drops transcript state', () => {
    const live = new MeetingLiveTranscript()
    live.reset('meeting-1', createRuntimeConfig())
    live.handleRecognitionEvent({
      type: 'block-committed',
      payload: {
        block: {
          id: 'b1',
          text: 'hello',
          source: 'system',
          startedAt: 1,
          endedAt: 2
        }
      }
    })
    live.clear()

    expect(live.getSnapshotFields().transcript.committedBlocks).toHaveLength(0)
    expect(live.handleRecognitionEvent({ type: 'session-ready' })).toBe(false)
  })
})

function createRuntimeConfig(options?: { withTranslation?: boolean }): ResolvedRuntimeConfig {
  const profile = profileCatalog[0]!

  return {
    engineProfile: profile,
    engineConfig: {
      mode: 'meeting',
      profileId: profile.id,
      preset: profile.preset,
      language: 'en',
      diagnosticsEnabled: false,
      experimentalFlags: []
    },
    captureConfig: {
      sampleRate: 16000,
      chunkMs: 100
    },
    outputConfig: {
      method: 'clipboard'
    },
    ...(options?.withTranslation
      ? {
          translationConfig: {
            provider: 'openai-compatible' as const,
            targetLanguage: 'zh',
            sourceLanguage: 'en' as const,
            endpoint: 'http://localhost',
            credentials: {
              translationApiKey: 'test-key'
            }
          }
        }
      : {})
  }
}
