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

  it('waits for the websocket to open before sending the start-session message', async () => {
    const socket = createFakeSocket({ autoOpen: false })
    const harness = createHarness({ socket })
    let resolved = false

    const startPromise = harness.engine
      .startSession({
        sessionId: 'session-1',
        mode: 'ptt',
        sources: ['microphone'],
        language: 'auto',
        translation: {
          enabled: false
        }
      })
      .then(() => {
        resolved = true
      })

    await Promise.resolve()
    expect(resolved).toBe(false)
    expect(harness.socket.sentMessages).toEqual([])

    harness.socket.emitOpen()
    await startPromise

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

  it('keeps native translation disabled for local service sessions', async () => {
    const harness = createHarness()

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

    expect(harness.socket.sentMessages).toContainEqual({
      type: 'start-session',
      sessionId: 'session-1',
      mode: 'ptt',
      language: 'auto',
      translationEnabled: false
    })
  })
})

function createHarness(overrides: { socket?: ReturnType<typeof createFakeSocket> } = {}) {
  const socket = overrides.socket ?? createFakeSocket()
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

function createFakeSocket(options: { autoOpen?: boolean } = {}) {
  const listeners = {
    message: [] as Array<(event: { data: string }) => void>,
    error: [] as Array<(event: unknown) => void>,
    open: [] as Array<() => void>,
    close: [] as Array<() => void>
  }
  let isOpen = false
  let openScheduled = false

  const socket = {
    sentMessages: [] as LocalServiceClientMessage[],
    addEventListener(type: keyof typeof listeners, listener: never) {
      listeners[type].push(listener)

      if (type === 'open' && (options.autoOpen ?? true) && !openScheduled) {
        openScheduled = true
        queueMicrotask(() => {
          socket.emitOpen()
        })
      }
    },
    send(data: string) {
      if (!isOpen) {
        throw new DOMException('Sent before connected.', 'InvalidStateError')
      }

      this.sentMessages.push(JSON.parse(data) as LocalServiceClientMessage)
    },
    close() {
      isOpen = false
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
    },
    emitOpen() {
      isOpen = true
      for (const listener of listeners.open) {
        listener()
      }
    }
  }

  return socket
}
