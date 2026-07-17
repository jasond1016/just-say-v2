import { describe, expect, it, vi } from 'vitest'

import type {
  LocalServiceClientMessage,
  LocalServiceServerMessage
} from '../../shared/local-service-types'
import { getDefaultLocalServiceCapabilities } from './python-local-service-controller'
import { SidecarProtocol } from './sidecar-protocol'

describe('SidecarProtocol', () => {
  it('parses health-check responses into runtime identity results', async () => {
    const protocol = new SidecarProtocol({
      webSocketFactory: createFakeWebSocketFactory([
        {
          type: 'health-status',
          ok: true,
          runtimeFamilyId: 'sensevoice',
          modelIdentifier: 'iic/SenseVoiceSmall',
          readiness: 'ready',
          capabilities: getDefaultLocalServiceCapabilities()
        }
      ])
    })

    await expect(
      protocol.healthCheck('ws://127.0.0.1:8765', {
        runtimeFamilyId: 'sensevoice',
        modelIdentifier: 'iic/SenseVoiceSmall'
      })
    ).resolves.toEqual({
      ok: true,
      runtimeFamilyId: 'sensevoice',
      modelIdentifier: 'iic/SenseVoiceSmall',
      readiness: 'ready'
    })
  })

  it('follows prewarm-complete with a health check', async () => {
    const protocol = new SidecarProtocol({
      webSocketFactory: createFakeWebSocketFactory([
        { type: 'prewarm-complete', runtimeFamilyId: 'qwen3-asr', modelIdentifier: 'Qwen3-ASR' },
        {
          type: 'health-status',
          ok: true,
          runtimeFamilyId: 'qwen3-asr',
          modelIdentifier: 'Qwen3-ASR',
          readiness: 'ready',
          capabilities: getDefaultLocalServiceCapabilities()
        }
      ])
    })

    await expect(
      protocol.prewarm(
        'ws://127.0.0.1:8765',
        { mode: 'meeting', language: 'auto' },
        {
          runtimeFamilyId: 'qwen3-asr',
          modelIdentifier: 'Qwen3-ASR'
        }
      )
    ).resolves.toEqual({
      ok: true,
      runtimeFamilyId: 'qwen3-asr',
      modelIdentifier: 'Qwen3-ASR',
      readiness: 'ready'
    })
  })

  it('returns structured failures for unexpected protocol responses', async () => {
    const protocol = new SidecarProtocol({
      webSocketFactory: createFakeWebSocketFactory([
        {
          type: 'session-ready',
          sessionId: 'session-1'
        }
      ])
    })

    await expect(
      protocol.healthCheck('ws://127.0.0.1:8765', {
        runtimeFamilyId: 'sensevoice',
        modelIdentifier: 'iic/SenseVoiceSmall'
      })
    ).resolves.toEqual({
      ok: false,
      runtimeFamilyId: 'sensevoice',
      modelIdentifier: 'iic/SenseVoiceSmall',
      readiness: 'prewarm-required',
      detail: {
        reason: 'unexpected-response',
        responseType: 'session-ready'
      }
    })
  })

  it('opens a long-lived session stream for recognition messages', async () => {
    const socket = createStreamFakeSocket({ autoOpen: true })
    const protocol = new SidecarProtocol({
      webSocketFactory: () => socket
    })
    const onMessage = vi.fn()

    const stream = await protocol.openSessionStream('ws://127.0.0.1:8765', {
      onMessage
    })

    stream.send({
      type: 'start-session',
      sessionId: 'session-1',
      mode: 'ptt',
      language: 'auto',
      translationEnabled: false
    })

    expect(socket.sentMessages).toEqual([
      {
        type: 'start-session',
        sessionId: 'session-1',
        mode: 'ptt',
        language: 'auto',
        translationEnabled: false
      }
    ])

    socket.emitMessage({
      type: 'session-ready',
      sessionId: 'session-1'
    })

    expect(onMessage).toHaveBeenCalledWith({
      type: 'session-ready',
      sessionId: 'session-1'
    })
  })

  it('waits for the websocket to open before resolving the session stream', async () => {
    const socket = createStreamFakeSocket({ autoOpen: false })
    const protocol = new SidecarProtocol({
      webSocketFactory: () => socket
    })
    let resolved = false

    const openPromise = protocol
      .openSessionStream('ws://127.0.0.1:8765', {
        onMessage: vi.fn()
      })
      .then(() => {
        resolved = true
      })

    await vi.waitFor(() => {
      expect(socket.openListenerCount()).toBe(1)
    })
    expect(resolved).toBe(false)

    socket.emitOpen()
    await openPromise
    expect(resolved).toBe(true)
  })
})

function createFakeWebSocketFactory(responses: LocalServiceServerMessage[]) {
  const queue = [...responses]

  return vi.fn(() => {
    const listeners = {
      open: [] as Array<() => void>,
      message: [] as Array<(event: { data: string }) => void>,
      error: [] as Array<(event: unknown) => void>,
      close: [] as Array<() => void>
    }

    queueMicrotask(() => {
      for (const listener of listeners.open) {
        listener()
      }
    })

    return {
      addEventListener(type: keyof typeof listeners, listener: never) {
        listeners[type].push(listener)
      },
      send(data: string) {
        const request = JSON.parse(data) as LocalServiceClientMessage
        const response = queue.shift()

        if (!response) {
          throw new Error('Missing fake websocket response')
        }

        if (request.type === 'health-check') {
          expect(response.type === 'health-status' || response.type === 'session-ready').toBe(true)
        }

        if (request.type === 'prewarm') {
          expect(['prewarm-complete', 'health-status'].includes(response.type)).toBe(true)
        }

        queueMicrotask(() => {
          for (const listener of listeners.message) {
            listener({
              data: JSON.stringify(response)
            })
          }
        })
      },
      close() {
        for (const listener of listeners.close) {
          listener()
        }
      }
    }
  })
}

function createStreamFakeSocket(options: { autoOpen: boolean }) {
  const listeners = {
    open: [] as Array<() => void>,
    message: [] as Array<(event: { data: string }) => void>,
    error: [] as Array<(event: unknown) => void>,
    close: [] as Array<() => void>
  }
  const sentMessages: LocalServiceClientMessage[] = []

  const socket = {
    sentMessages,
    addEventListener(type: keyof typeof listeners, listener: never) {
      listeners[type].push(listener)
    },
    send(data: string) {
      sentMessages.push(JSON.parse(data) as LocalServiceClientMessage)
    },
    close() {
      for (const listener of listeners.close) {
        listener()
      }
    },
    openListenerCount() {
      return listeners.open.length
    },
    emitOpen() {
      for (const listener of listeners.open) {
        listener()
      }
    },
    emitMessage(message: LocalServiceServerMessage) {
      for (const listener of listeners.message) {
        listener({ data: JSON.stringify(message) })
      }
    }
  }

  if (options.autoOpen) {
    queueMicrotask(() => {
      socket.emitOpen()
    })
  }

  return socket
}
