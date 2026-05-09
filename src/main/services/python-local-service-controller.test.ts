import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import {
  PythonLocalServiceController,
  getDefaultLocalServiceCapabilities
} from './python-local-service-controller'
import type {
  LocalServiceClientMessage,
  LocalServiceServerMessage
} from '../../shared/local-service-types'

describe('PythonLocalServiceController', () => {
  it('starts the python service and waits for a healthy websocket response', async () => {
    const spawn = vi.fn(() => createFakeChildProcess())
    const webSocketFactory = createFakeWebSocketFactory([
      {
        type: 'health-status',
        ok: true,
        model: 'iic/SenseVoiceSmall',
        capabilities: getDefaultLocalServiceCapabilities()
      }
    ])
    const controller = createController({ spawn, webSocketFactory })

    await controller.start()

    expect(spawn).toHaveBeenCalledWith(
      'uv',
      ['run', '--project', '.', 'service.py'],
      expect.objectContaining({
        env: expect.objectContaining({
          JUSTSAY_LOCAL_SERVICE_HOST: '127.0.0.1',
          JUSTSAY_LOCAL_SERVICE_PORT: '8765',
          JUSTSAY_LOCAL_SERVICE_MODEL: 'iic/SenseVoiceSmall'
        })
      })
    )
  })

  it('reports health status over websocket', async () => {
    const controller = createController({
      webSocketFactory: createFakeWebSocketFactory([
        {
          type: 'health-status',
          ok: true,
          model: 'iic/SenseVoiceSmall',
          capabilities: getDefaultLocalServiceCapabilities()
        }
      ])
    })

    await expect(controller.healthCheck()).resolves.toEqual({ ok: true })
  })

  it('stops the spawned python process', async () => {
    const child = createFakeChildProcess()
    const controller = createController({
      spawn: vi.fn(() => child),
      webSocketFactory: createFakeWebSocketFactory([
        {
          type: 'health-status',
          ok: true,
          model: 'iic/SenseVoiceSmall',
          capabilities: getDefaultLocalServiceCapabilities()
        }
      ])
    })

    await controller.start()
    await controller.stop()

    expect(child.kill).toHaveBeenCalledTimes(1)
  })
})

function createController(
  overrides: Partial<ConstructorParameters<typeof PythonLocalServiceController>[0]> = {}
) {
  return new PythonLocalServiceController({
    host: '127.0.0.1',
    port: 8765,
    scriptPath: 'service.py',
    workingDirectory: '.',
    healthTimeoutMs: 50,
    ...overrides
  })
}

function createFakeChildProcess() {
  const emitter = new EventEmitter()

  return {
    killed: false,
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    once: emitter.once.bind(emitter),
    on: emitter.on.bind(emitter),
    kill: vi.fn(() => {
      emitter.emit('exit')
      return true
    })
  }
}

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
        expect(request.type).toBe('health-check')
        const response = queue.shift()

        if (!response) {
          throw new Error('Missing fake websocket response')
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
