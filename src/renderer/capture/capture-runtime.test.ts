import { describe, expect, it } from 'vitest'

import type { CaptureApi } from '../../preload/capture'
import type { AudioChunk, CaptureCommand, CaptureEvent } from '../../shared/api-types'
import type { CaptureSource } from '../../shared/primitive-types'
import { CaptureRuntime, type CaptureSourceInstance, type CaptureSourceManager } from './capture-runtime'

describe('CaptureRuntime', () => {
  it('announces readiness and runs a capture session lifecycle', async () => {
    const api = createFakeCaptureApi()
    const manager = new FakeCaptureSourceManager()
    const runtime = new CaptureRuntime(api, manager)

    runtime.start()
    api.emitCommand({
      type: 'start',
      requestId: 'cap-1',
      sources: ['microphone'],
      sampleRate: 16000,
      chunkMs: 100
    })

    await flushAsyncWork()

    manager.instances[0]?.emitChunk({
      source: 'microphone',
      data: new Uint8Array([1, 2]),
      sampleRate: 16000,
      channels: 1,
      timestamp: 1
    })
    api.emitCommand({
      type: 'stop',
      requestId: 'cap-1'
    })

    await flushAsyncWork()

    expect(api.sentEvents).toEqual([
      {
        type: 'capture-started',
        requestId: 'cap-1',
        sources: ['microphone']
      },
      {
        type: 'audio-chunk',
        requestId: 'cap-1',
        chunk: {
          source: 'microphone',
          data: new Uint8Array([1, 2]),
          sampleRate: 16000,
          channels: 1,
          timestamp: 1
        }
      },
      {
        type: 'capture-stopped',
        requestId: 'cap-1'
      }
    ])
    expect(api.readyNotifications).toBe(1)
    expect(manager.instances[0]?.startCalls).toBe(1)
    expect(manager.instances[0]?.stopCalls).toBe(1)
    runtime.dispose()
  })

  it('reports an error when another capture session is already active', async () => {
    const api = createFakeCaptureApi()
    const manager = new FakeCaptureSourceManager()
    const runtime = new CaptureRuntime(api, manager)

    api.emitCommand({
      type: 'start',
      requestId: 'cap-2',
      sources: ['microphone'],
      sampleRate: 16000,
      chunkMs: 100
    })
    await flushAsyncWork()
    api.emitCommand({
      type: 'start',
      requestId: 'cap-3',
      sources: ['system'],
      sampleRate: 16000,
      chunkMs: 100
    })
    await flushAsyncWork()

    expect(api.sentEvents[1]).toEqual({
      type: 'capture-error',
      requestId: 'cap-3',
      error: {
        code: 'E_CAPTURE_UNAVAILABLE',
        message: 'Another capture session is already active',
        retryable: true
      }
    })
    runtime.dispose()
  })

  it('emits a capture error when source creation fails', async () => {
    const api = createFakeCaptureApi()
    const manager = new FakeCaptureSourceManager({
      failure: new Error('Permission denied')
    })
    const runtime = new CaptureRuntime(api, manager)

    api.emitCommand({
      type: 'start',
      requestId: 'cap-4',
      sources: ['microphone'],
      sampleRate: 16000,
      chunkMs: 100
    })
    await flushAsyncWork()

    expect(api.sentEvents).toEqual([
      {
        type: 'capture-error',
        requestId: 'cap-4',
        error: {
          code: 'E_CAPTURE_UNAVAILABLE',
          message: 'Permission denied',
          retryable: true
        }
      }
    ])
    runtime.dispose()
  })
})

function createFakeCaptureApi() {
  let commandListener: ((command: CaptureCommand) => void) | null = null

  const api: CaptureApi & {
    sentEvents: CaptureEvent[]
    readyNotifications: number
    emitCommand(command: CaptureCommand): void
  } = {
    sentEvents: [],
    readyNotifications: 0,
    onCommand(listener) {
      commandListener = listener
      return () => {
        commandListener = null
      }
    },
    sendEvent(event) {
      this.sentEvents.push(event)
    },
    notifyReady() {
      this.readyNotifications += 1
    },
    emitCommand(command) {
      commandListener?.(command)
    }
  }

  return api
}

class FakeCaptureSourceManager implements CaptureSourceManager {
  readonly instances: FakeCaptureSource[] = []

  constructor(private readonly options: { failure?: Error } = {}) {}

  async createSource(input: {
    requestId: string
    source: CaptureSource
    microphoneDeviceId?: string
    systemSourceId?: string
    sampleRate: number
    chunkMs: number
  }): Promise<CaptureSourceInstance> {
    if (this.options.failure) {
      throw this.options.failure
    }

    const instance = new FakeCaptureSource(input.source)
    this.instances.push(instance)
    return instance
  }
}

class FakeCaptureSource implements CaptureSourceInstance {
  private readonly listeners = new Set<(chunk: AudioChunk) => void>()
  startCalls = 0
  stopCalls = 0
  abortCalls = 0

  constructor(private readonly source: CaptureSource) {
    void this.source
  }

  onChunk(listener: (chunk: AudioChunk) => void): () => void {
    this.listeners.add(listener)

    return () => {
      this.listeners.delete(listener)
    }
  }

  async start(): Promise<void> {
    this.startCalls += 1
  }

  async stop(): Promise<void> {
    this.stopCalls += 1
  }

  async abort(): Promise<void> {
    this.abortCalls += 1
  }

  emitChunk(chunk: AudioChunk): void {
    for (const listener of this.listeners) {
      listener(chunk)
    }
  }
}

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}
