import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PythonLocalServiceController,
  getDefaultLocalServiceCapabilities
} from './python-local-service-controller'
import type {
  LocalServiceClientMessage,
  LocalServiceServerMessage
} from '../../shared/local-service-types'

type FakeChildProcess = {
  killed: boolean
  pid: number | undefined
  stdout: EventEmitter
  stderr: EventEmitter
  once: EventEmitter['once']
  on: EventEmitter['on']
  emit: EventEmitter['emit']
  kill: ReturnType<typeof vi.fn<() => boolean>>
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('PythonLocalServiceController', () => {
  it('starts the python service and waits for a healthy websocket response', async () => {
    const spawn = vi.fn(() => createFakeChildProcess())
    const webSocketFactory = createFakeWebSocketFactory([
      {
        type: 'health-status',
        ok: true,
        runtimeFamilyId: 'sensevoice',
        modelIdentifier: 'iic/SenseVoiceSmall',
        readiness: 'ready',
        capabilities: getDefaultLocalServiceCapabilities()
      }
    ])
    const controller = createController({ spawn, webSocketFactory })

    await controller.start(createTarget())

    expect(spawn).toHaveBeenCalledWith(
      'uv',
      ['run', '--project', '.', 'python', 'service.py'],
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
          runtimeFamilyId: 'sensevoice',
          modelIdentifier: 'iic/SenseVoiceSmall',
          readiness: 'ready',
          capabilities: getDefaultLocalServiceCapabilities()
        }
      ])
    })

    await expect(controller.healthCheck(createTarget())).resolves.toEqual({
      ok: true,
      runtimeFamilyId: 'sensevoice',
      modelIdentifier: 'iic/SenseVoiceSmall',
      readiness: 'ready'
    })
  })

  it('stops the spawned python process', async () => {
    const child = createFakeChildProcess()
    const controller = createController({
      spawn: vi.fn(() => child),
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

    await controller.start(createTarget())
    await controller.stop()

    expect(child.kill).toHaveBeenCalledTimes(1)
  })

  it('terminates the full process tree when a pid is available', async () => {
    const child = createFakeChildProcess({ pid: 4242 })
    const terminateProcessTree = vi.fn(async () => {
      child.emit('exit')
    })
    const controller = createController({
      spawn: vi.fn(() => child),
      terminateProcessTree,
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

    await controller.start(createTarget())
    await controller.stop()

    expect(terminateProcessTree).toHaveBeenCalledWith(4242)
    expect(child.kill).not.toHaveBeenCalled()
  })

  it('kills the spawned process if health never becomes ready', async () => {
    const child = createFakeChildProcess()
    const controller = createController({
      healthTimeoutMs: 20,
      spawn: vi.fn(() => child),
      webSocketFactory: createFailingWebSocketFactory()
    })

    await expect(controller.start(createTarget())).rejects.toThrow('Local service websocket request failed')
    expect(child.kill).toHaveBeenCalledTimes(1)
  })

  it('forwards child stdout and stderr to the main process logs', async () => {
    const child = createFakeChildProcess()
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const controller = createController({
      spawn: vi.fn(() => child),
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

    const startPromise = controller.start(createTarget())
    child.stdout.emit('data', Buffer.from('hello from python\n{"type":"ready"}\n', 'utf8'))
    child.stderr.emit('data', Buffer.from('stderr line 1\nstderr line 2\n', 'utf8'))
    await startPromise

    expect(logSpy).toHaveBeenCalledWith('[local-service] hello from python')
    expect(logSpy).toHaveBeenCalledWith('[local-service] {"type":"ready"}')
    expect(errorSpy).toHaveBeenCalledWith('[local-service] stderr line 1')
    expect(errorSpy).toHaveBeenCalledWith('[local-service] stderr line 2')
  })

  it('flushes buffered child output when the process exits', async () => {
    const child = createFakeChildProcess()
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const controller = createController({
      spawn: vi.fn(() => child),
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

    await controller.start(createTarget())
    child.stdout.emit('data', Buffer.from('partial stdout', 'utf8'))
    child.stderr.emit('data', Buffer.from('partial stderr', 'utf8'))
    await controller.stop()

    expect(logSpy).toHaveBeenCalledWith('[local-service] partial stdout')
    expect(errorSpy).toHaveBeenCalledWith('[local-service] partial stderr')
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

function createTarget() {
  return {
    mode: 'managed-local' as const,
    host: '127.0.0.1',
    port: 8765,
    runtimeFamilyId: 'sensevoice' as const,
    modelIdentifier: 'iic/SenseVoiceSmall'
  }
}

function createFakeChildProcess(overrides: { pid?: number } = {}): FakeChildProcess {
  const emitter = new EventEmitter()
  const stdout = new EventEmitter()
  const stderr = new EventEmitter()

  return {
    killed: false,
    pid: overrides.pid,
    stdout,
    stderr,
    once: emitter.once.bind(emitter),
    on: emitter.on.bind(emitter),
    emit: emitter.emit.bind(emitter),
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

function createFailingWebSocketFactory() {
  return vi.fn(() => {
    const listeners = {
      open: [] as Array<() => void>,
      message: [] as Array<(event: { data: string }) => void>,
      error: [] as Array<(event: unknown) => void>,
      close: [] as Array<() => void>
    }

    queueMicrotask(() => {
      for (const listener of listeners.error) {
        listener({ type: 'error' })
      }
    })

    return {
      addEventListener(type: keyof typeof listeners, listener: never) {
        listeners[type].push(listener)
      },
      send() {},
      close() {
        for (const listener of listeners.close) {
          listener()
        }
      }
    }
  })
}
