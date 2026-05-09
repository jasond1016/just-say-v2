import { describe, expect, it, vi } from 'vitest'
import type { RecognitionEvent } from '../../core/contracts/engine'
import { profileCatalog } from '../../core/settings/profile-catalog'
import type { ResolvedRuntimeConfig } from '../../shared/api-types'
import type { LocalServiceClientMessage } from '../../shared/local-service-types'
import { LocalEngineAdapter } from './local-engine-adapter'

describe('LocalEngineAdapter', () => {
  it('ensures the local service is ready before starting a session', async () => {
    const harness = createHarness()

    await harness.engine.startSession({
      sessionId: 'session-1',
      mode: 'ptt',
      sources: ['microphone'],
      language: 'auto',
      translation: {
        enabled: false
      }
    })

    expect(harness.ensureLocalServiceReady).toHaveBeenCalledTimes(1)
    expect(harness.socket.sentMessages).toContainEqual({
      type: 'start-session',
      sessionId: 'session-1',
      mode: 'ptt',
      language: 'auto',
      translationEnabled: false
    })
  })

  it('forwards websocket messages as unified recognition events', async () => {
    const harness = createHarness()
    const seenEvents: RecognitionEvent[] = []
    harness.engine.onEvent((event) => {
      seenEvents.push(event)
    })

    await harness.engine.startSession({
      sessionId: 'session-1',
      mode: 'meeting',
      sources: ['system'],
      language: 'ja',
      translation: {
        enabled: false
      }
    })

    harness.socket.emit({
      type: 'session-ready',
      sessionId: 'session-1'
    })
    harness.socket.emit({
      type: 'draft-updated',
      sessionId: 'session-1',
      payload: {
        blockId: 'draft-1',
        source: 'system',
        stableText: 'hello',
        previewText: 'hello world',
        startedAt: 1000,
        updatedAt: 1200
      }
    })
    harness.socket.emit({
      type: 'block-committed',
      sessionId: 'session-1',
      payload: {
        block: {
          id: 'draft-1',
          source: 'system',
          text: 'hello world',
          startedAt: 1000,
          endedAt: 1300
        }
      }
    })
    harness.socket.emit({
      type: 'session-ended',
      sessionId: 'session-1'
    })

    expect(seenEvents).toMatchObject([
      { type: 'session-ready' },
      {
        type: 'draft-updated',
        payload: {
          previewText: 'hello world'
        }
      },
      {
        type: 'block-committed',
        payload: {
          block: {
            text: 'hello world'
          }
        }
      },
      { type: 'session-ended' }
    ])
  })

  it('encodes pushed audio chunks and sends them to the local service', async () => {
    const harness = createHarness()

    await harness.engine.startSession({
      sessionId: 'session-1',
      mode: 'ptt',
      sources: ['microphone'],
      language: 'auto',
      translation: {
        enabled: false
      }
    })
    harness.engine.pushAudio({
      source: 'microphone',
      data: new Uint8Array([1, 2, 3]),
      sampleRate: 16000,
      channels: 1,
      timestamp: 2222
    })

    expect(harness.socket.sentMessages).toContainEqual({
      type: 'audio-chunk',
      sessionId: 'session-1',
      chunk: {
        source: 'microphone',
        sampleRate: 16000,
        channels: 1,
        timestamp: 2222,
        dataBase64: 'AQID'
      }
    })
  })

  it('warns when translation is requested but unavailable in the local service', async () => {
    const harness = createHarness()
    const seenEvents: RecognitionEvent[] = []
    harness.engine.onEvent((event) => {
      seenEvents.push(event)
    })

    await harness.engine.startSession({
      sessionId: 'session-1',
      mode: 'ptt',
      sources: ['microphone'],
      language: 'auto',
      translation: {
        enabled: true,
        targetLanguage: 'en'
      }
    })

    expect(seenEvents).toContainEqual({
      type: 'warning',
      payload: {
        code: 'W_TRANSLATION_DISABLED',
        message: 'Local SenseVoice service is running without cloud translation.',
        recoverable: true
      }
    })
  })
})

function createHarness() {
  const socket = createFakeSocket()
  const ensureLocalServiceReady = vi.fn(async () => {})
  const config: ResolvedRuntimeConfig = {
    engineProfile: profileCatalog[0]!,
    engineConfig: {
      localService: {
        host: '127.0.0.1',
        port: 8765
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
  const engine = new LocalEngineAdapter(config, {
    ensureLocalServiceReady,
    webSocketFactory: () => socket
  })

  return {
    engine,
    socket,
    ensureLocalServiceReady
  }
}

function createFakeSocket() {
  const listeners = {
    message: [] as Array<(event: { data: string }) => void>,
    error: [] as Array<(event: unknown) => void>,
    open: [] as Array<() => void>,
    close: [] as Array<() => void>
  }

  queueMicrotask(() => {
    for (const listener of listeners.open) {
      listener()
    }
  })

  return {
    sentMessages: [] as LocalServiceClientMessage[],
    addEventListener(type: keyof typeof listeners, listener: never) {
      listeners[type].push(listener)
    },
    send(data: string) {
      this.sentMessages.push(JSON.parse(data) as LocalServiceClientMessage)
    },
    close() {
      for (const listener of listeners.close) {
        listener()
      }
    },
    emit(message: object) {
      for (const listener of listeners.message) {
        listener({
          data: JSON.stringify(message)
        })
      }
    }
  }
}
