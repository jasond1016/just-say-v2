import { describe, expect, it, vi } from 'vitest'
import type { RecognitionEvent } from '../../core/contracts/engine'
import { profileCatalog } from '../../core/settings/profile-catalog'
import type { ResolvedRuntimeConfig } from '../../shared/api-types'
import type { RealtimeTranscriptionClientEvent } from '../services/openai-realtime-transcription-protocol'
import { SenseVoiceRealtimeEngineAdapter } from './sensevoice-realtime-engine-adapter'

describe('SenseVoiceRealtimeEngineAdapter', () => {
  it('uses manual turn detection for PTT and waits for the final transcript before ending', async () => {
    const harness = createHarness()
    const events: RecognitionEvent[] = []
    harness.engine.onEvent((event) => events.push(event))

    await harness.engine.startSession(createStartInput('ptt', ['microphone']))
    harness.engine.pushAudio(createChunk('microphone', 1_100))
    harness.socket.emit({
      type: 'conversation.item.input_audio_transcription.delta',
      item_id: 'it_0',
      delta: 'hello',
      transcript: 'hello'
    })
    await harness.engine.stopSession()

    expect(harness.socket.sentMessages[0]).toEqual({
      type: 'session.update',
      session: {
        input_audio_format: 'pcm16',
        turn_detection: { type: 'none' }
      }
    })
    expect(harness.socket.sentMessages).toContainEqual({
      type: 'input_audio_buffer.append',
      audio: Buffer.alloc(3_200).toString('base64')
    })
    expect(harness.socket.sentMessages.at(-1)).toEqual({
      type: 'input_audio_buffer.commit'
    })
    expect(events.some((event) => event.type === 'session-ended')).toBe(false)

    harness.socket.emit({
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: 'it_0',
      transcript: 'hello',
      language: 'en'
    })

    expect(events).toMatchObject([
      { type: 'session-ready' },
      {
        type: 'draft-updated',
        payload: {
          source: 'microphone',
          stableText: '',
          previewText: 'hello',
          startedAt: 1_000,
          updatedAt: 1_100
        }
      },
      {
        type: 'block-committed',
        payload: {
          block: {
            source: 'microphone',
            text: 'hello',
            startedAt: 1_000,
            endedAt: 1_100
          }
        }
      },
      { type: 'session-ended' }
    ])
  })

  it('uses server VAD and maps patched segment timing for a single-source meeting', async () => {
    const harness = createHarness()
    const events: RecognitionEvent[] = []
    harness.engine.onEvent((event) => events.push(event))

    await harness.engine.startSession(createStartInput('meeting', ['system']))
    harness.engine.pushAudio(createChunk('system', 1_100))
    harness.engine.pushAudio(createChunk('system', 1_200))
    harness.socket.emit({
      type: 'input_audio_buffer.speech_started',
      audio_start_ms: 20
    })
    harness.socket.emit({
      type: 'conversation.item.input_audio_transcription.delta',
      item_id: 'it_20',
      delta: 'old hypothesis',
      transcript: 'revised hypothesis'
    })
    harness.socket.emit({
      type: 'input_audio_buffer.speech_stopped',
      audio_end_ms: 180
    })
    harness.socket.emit({
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: 'it_20',
      transcript: 'final text'
    })
    await harness.engine.stopSession()

    expect(harness.socket.sentMessages[0]).toMatchObject({
      type: 'session.update',
      session: { turn_detection: { type: 'server_vad' } }
    })
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'draft-updated',
        payload: expect.objectContaining({
          source: 'system',
          previewText: 'revised hypothesis',
          startedAt: 1_020
        })
      })
    )
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'block-committed',
        payload: {
          block: expect.objectContaining({
            source: 'system',
            text: 'final text',
            startedAt: 1_020,
            endedAt: 1_180
          })
        }
      })
    )
    expect(events.at(-1)).toEqual({ type: 'session-ended' })
    expect(harness.socket.sentMessages).not.toContainEqual({
      type: 'input_audio_buffer.commit'
    })
  })

  it('rejects dual-source meetings during the native validation phase', async () => {
    const harness = createHarness()

    await expect(
      harness.engine.startSession(createStartInput('meeting', ['system', 'microphone']))
    ).rejects.toMatchObject({
      payload: {
        code: 'E_ENGINE_UNAVAILABLE',
        retryable: false
      }
    })
    expect(harness.establishReadiness).not.toHaveBeenCalled()
  })

  it('clears the realtime buffer without committing when a session is aborted', async () => {
    const harness = createHarness()
    await harness.engine.startSession(createStartInput('ptt', ['microphone']))

    await harness.engine.abortSession()

    expect(harness.socket.sentMessages.at(-1)).toEqual({
      type: 'input_audio_buffer.clear'
    })
    expect(harness.socket.closed).toBe(true)
  })
})

function createHarness() {
  const socket = createFakeSocket()
  const establishReadiness = vi.fn(async () => ({
    health: {
      ok: true,
      runtimeFamilyId: 'sensevoice' as const,
      modelIdentifier: 'iic/SenseVoiceSmall',
      readiness: 'ready' as const
    },
    prewarmTriggered: true,
    identityMismatch: false
  }))
  const engine = new SenseVoiceRealtimeEngineAdapter(createConfig(), {
    establishReadiness,
    webSocketFactory: () => socket
  })
  return { engine, socket, establishReadiness }
}

function createConfig(): ResolvedRuntimeConfig {
  return {
    engineProfile: profileCatalog[0]!,
    engineConfig: {
      mode: 'meeting',
      profileId: 'local-fast',
      preset: 'local-fast',
      language: 'auto',
      diagnosticsEnabled: true,
      experimentalFlags: ['native-sensevoice'],
      localService: {
        mode: 'managed-local',
        host: '127.0.0.1',
        port: 8765,
        runtimeFamilyId: 'sensevoice',
        modelIdentifier: 'iic/SenseVoiceSmall',
        protocol: 'openai-realtime'
      }
    },
    captureConfig: { sampleRate: 16000, chunkMs: 100 },
    outputConfig: { method: 'simulate_input' }
  }
}

function createStartInput(
  mode: 'ptt' | 'meeting',
  sources: Array<'microphone' | 'system'>
) {
  return {
    sessionId: 'session-1',
    mode,
    sources,
    language: 'auto',
    translation: { enabled: false }
  }
}

function createChunk(source: 'microphone' | 'system', timestamp: number) {
  return {
    source,
    data: new Uint8Array(3_200),
    sampleRate: 16_000,
    channels: 1 as const,
    timestamp
  }
}

function createFakeSocket() {
  const listeners = {
    message: [] as Array<(event: { data: string }) => void>,
    error: [] as Array<(event: unknown) => void>,
    open: [] as Array<() => void>,
    close: [] as Array<() => void>
  }
  let opened = false
  let openScheduled = false

  const socket = {
    sentMessages: [] as RealtimeTranscriptionClientEvent[],
    closed: false,
    addEventListener(type: keyof typeof listeners, listener: never) {
      listeners[type].push(listener)
      if (type === 'open' && !openScheduled) {
        openScheduled = true
        queueMicrotask(() => socket.emitOpen())
      }
    },
    send(data: string) {
      if (!opened) {
        throw new Error('socket is not open')
      }
      this.sentMessages.push(JSON.parse(data) as RealtimeTranscriptionClientEvent)
    },
    close() {
      opened = false
      this.closed = true
      for (const listener of listeners.close) {
        listener()
      }
    },
    emit(message: object) {
      for (const listener of listeners.message) {
        listener({ data: JSON.stringify(message) })
      }
    },
    emitOpen() {
      opened = true
      for (const listener of listeners.open) {
        listener()
      }
    }
  }
  return socket
}
