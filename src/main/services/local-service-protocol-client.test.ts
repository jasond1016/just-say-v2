import { describe, expect, it, vi } from 'vitest'

import type {
  LocalServiceClientMessage,
  LocalServiceServerMessage
} from '../../shared/local-service-types'
import { LocalServiceProtocolClient } from './local-service-protocol-client'

describe('LocalServiceProtocolClient', () => {
  it('parses health-check responses into runtime identity results', async () => {
    const client = new LocalServiceProtocolClient({
      webSocketFactory: createFakeWebSocketFactory([
        {
          type: 'health-status',
          ok: true,
          runtimeFamilyId: 'sensevoice',
          modelIdentifier: 'iic/SenseVoiceSmall',
          readiness: 'ready'
        }
      ])
    })

    await expect(
      client.healthCheck('ws://127.0.0.1:8765', {
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
    const client = new LocalServiceProtocolClient({
      webSocketFactory: createFakeWebSocketFactory([
        { type: 'prewarm-complete' },
        {
          type: 'health-status',
          ok: true,
          runtimeFamilyId: 'qwen3-asr',
          modelIdentifier: 'Qwen3-ASR',
          readiness: 'ready'
        }
      ])
    })

    await expect(
      client.prewarm(
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
    const client = new LocalServiceProtocolClient({
      webSocketFactory: createFakeWebSocketFactory([
        {
          type: 'session-ready',
          sessionId: 'session-1'
        }
      ])
    })

    await expect(
      client.healthCheck('ws://127.0.0.1:8765', {
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
