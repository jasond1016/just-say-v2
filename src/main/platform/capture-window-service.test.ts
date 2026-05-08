import { describe, expect, it } from 'vitest'

import type { CaptureCommand, CaptureEvent } from '../../shared/api-types'
import { CaptureWindowService } from './capture-window-service'

describe('CaptureWindowService', () => {
  it('ensures the transport is prepared only once', async () => {
    const transport = createFakeTransport()
    const service = new CaptureWindowService(transport)

    await service.ensureReady()
    await service.ensureReady()

    expect(transport.ensureReadyCalls).toBe(1)
  })

  it('starts capture with default settings and normalized sources', async () => {
    const transport = createFakeTransport()
    const service = new CaptureWindowService(transport, {
      createRequestId: () => 'req-1'
    })

    const activeRequest = await service.startCapture({
      sources: ['microphone', 'microphone', 'system'],
      microphoneDeviceId: 'mic-1',
      systemSourceId: 'screen:1'
    })

    expect(activeRequest).toEqual({
      requestId: 'req-1',
      sources: ['microphone', 'system'],
      status: 'starting',
      startedAt: null
    })
    expect(transport.commands).toEqual([
      {
        type: 'start',
        requestId: 'req-1',
        sources: ['microphone', 'system'],
        microphoneDeviceId: 'mic-1',
        systemSourceId: 'screen:1',
        sampleRate: 16000,
        chunkMs: 100
      }
    ])
  })

  it('updates state when the transport reports capture lifecycle events', async () => {
    const transport = createFakeTransport()
    const service = new CaptureWindowService(transport, {
      createRequestId: () => 'req-2',
      now: () => 1234
    })
    const seenEvents: CaptureEvent[] = []
    service.onEvent((event) => {
      seenEvents.push(event)
    })

    await service.startCapture({
      sources: ['microphone']
    })
    transport.emit({
      type: 'capture-started',
      requestId: 'req-2',
      sources: ['microphone']
    })

    expect(service.getState().activeRequest).toEqual({
      requestId: 'req-2',
      sources: ['microphone'],
      status: 'capturing',
      startedAt: 1234
    })

    transport.emit({
      type: 'audio-chunk',
      requestId: 'req-2',
      chunk: {
        source: 'microphone',
        data: new Uint8Array([1, 2, 3]),
        sampleRate: 16000,
        channels: 1,
        timestamp: 777
      }
    })
    transport.emit({
      type: 'capture-stopped',
      requestId: 'req-2'
    })

    expect(service.getState().activeRequest).toBeNull()
    expect(seenEvents.map((event) => event.type)).toEqual([
      'capture-started',
      'audio-chunk',
      'capture-stopped'
    ])
  })

  it('sends stop and abort commands for the active request', async () => {
    const transport = createFakeTransport()
    const service = new CaptureWindowService(transport, {
      createRequestId: () => 'req-3'
    })

    await service.startCapture({
      sources: ['system']
    })

    await expect(service.stopCapture()).resolves.toBe(true)
    expect(transport.commands[1]).toEqual({
      type: 'stop',
      requestId: 'req-3'
    })

    transport.emit({
      type: 'capture-stopped',
      requestId: 'req-3'
    })

    await service.startCapture({
      sources: ['microphone'],
      requestId: 'req-4'
    })
    await expect(service.abortCapture()).resolves.toBe(true)
    expect(transport.commands[3]).toEqual({
      type: 'abort',
      requestId: 'req-4'
    })
  })

  it('rejects invalid or concurrent capture starts', async () => {
    const transport = createFakeTransport()
    const service = new CaptureWindowService(transport, {
      createRequestId: () => 'req-5'
    })

    await expect(
      service.startCapture({
        sources: []
      })
    ).rejects.toThrow('Capture requires at least one source')

    await service.startCapture({
      sources: ['microphone']
    })

    await expect(
      service.startCapture({
        sources: ['system']
      })
    ).rejects.toThrow('A capture request is already active')
  })

  it('records the last capture error and clears the active request', async () => {
    const transport = createFakeTransport()
    const service = new CaptureWindowService(transport, {
      createRequestId: () => 'req-6'
    })

    await service.startCapture({
      sources: ['microphone']
    })

    transport.emit({
      type: 'capture-error',
      requestId: 'req-6',
      error: {
        code: 'E_CAPTURE_PERMISSION',
        message: 'Mic permission denied',
        retryable: true
      }
    })

    expect(service.getState()).toEqual({
      activeRequest: null,
      lastError: {
        code: 'E_CAPTURE_PERMISSION',
        message: 'Mic permission denied',
        retryable: true
      }
    })
  })
})

function createFakeTransport() {
  const listeners = new Set<(event: CaptureEvent) => void>()

  return {
    ensureReadyCalls: 0,
    commands: [] as CaptureCommand[],
    async ensureReady() {
      this.ensureReadyCalls += 1
    },
    async sendCommand(command: CaptureCommand) {
      this.commands.push(command)
    },
    onEvent(listener: (event: CaptureEvent) => void) {
      listeners.add(listener)

      return () => {
        listeners.delete(listener)
      }
    },
    emit(event: CaptureEvent) {
      for (const listener of listeners) {
        listener(event)
      }
    }
  }
}
