import { describe, expect, it } from 'vitest'
import { resolveRuntimeConfig } from '../settings/settings-resolver'
import { DEFAULT_SETTINGS } from '../settings/settings-schema'
import {
  buildMeetingSavedTranscript,
  buildPttSavedTranscript,
  buildSessionTranscriptMetadata
} from './transcript-provenance'

const runtimeConfig = resolveRuntimeConfig({
  settings: {
    ...DEFAULT_SETTINGS,
    translation: {
      ...DEFAULT_SETTINGS.translation,
      enabledForMeeting: true,
      enabledForPtt: true,
      targetLanguage: 'en'
    }
  },
  mode: 'meeting',
  credentials: { translationApiKey: 'secret' }
})

describe('transcript provenance', () => {
  it('builds shared session metadata with optional audio', () => {
    expect(
      buildSessionTranscriptMetadata({
        runtimeConfig,
        includeMicrophone: true,
        translationEnabled: true,
        audio: {
          relativePath: 'meetings\\2026\\meeting-1.wav',
          format: 'wav',
          sampleRate: 16000,
          channels: 1,
          status: 'complete',
          durationMs: 1200,
          byteLength: 38444
        }
      })
    ).toMatchObject({
      engineProfileId: runtimeConfig.engineProfile.id,
      includeMicrophone: true,
      translationEnabled: true,
      audio: {
        relativePath: 'meetings\\2026\\meeting-1.wav',
        status: 'complete'
      }
    })
  })

  it('builds a PTT saved transcript record', () => {
    const record = buildPttSavedTranscript({
      sessionId: 'ptt-1',
      startedAt: 1000,
      endedAt: 2000,
      runtimeConfig,
      finalText: 'hello world',
      translatedText: '你好，世界'
    })

    expect(record).toMatchObject({
      id: 'ptt-1',
      mode: 'ptt',
      title: '你好，世界',
      plainText: 'hello world',
      translatedPlainText: '你好，世界',
      targetLanguage: 'en',
      blocks: [
        {
          id: 'ptt-1-block-1',
          text: 'hello world',
          translatedText: '你好，世界'
        }
      ]
    })
  })

  it('builds a meeting saved transcript record', () => {
    const record = buildMeetingSavedTranscript({
      sessionId: 'meeting-1',
      startedAt: 1_700_000_000_000,
      endedAt: 1_700_000_120_000,
      runtimeConfig,
      includeMicrophone: false,
      plainText: 'hello world',
      translatedPlainText: '你好，世界',
      blocks: [
        {
          id: 'block-1',
          source: 'system',
          text: 'hello world',
          translatedText: '你好，世界',
          startedAt: 1000,
          endedAt: 1200
        }
      ],
      audioMetadata: {
        relativePath: 'meetings\\2026\\meeting-1.wav',
        format: 'wav',
        sampleRate: 16000,
        channels: 1,
        status: 'partial',
        durationMs: 1200,
        byteLength: 38444
      }
    })

    expect(record).toMatchObject({
      id: 'meeting-1',
      mode: 'meeting',
      title: `Live Session ${new Date(1_700_000_000_000).toISOString()}`,
      plainText: 'hello world',
      translatedPlainText: '你好，世界',
      metadata: {
        includeMicrophone: false,
        audio: {
          relativePath: 'meetings\\2026\\meeting-1.wav',
          status: 'partial'
        }
      }
    })
  })
})
