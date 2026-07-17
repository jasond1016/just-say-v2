import { describe, expect, it, vi } from 'vitest'

import type { RecognitionEngine, RecognitionEvent } from '../../core/contracts/engine'
import { profileCatalog } from '../../core/settings/profile-catalog'
import type { CaptureEvent, ResolvedRuntimeConfig } from '../../shared/api-types'
import type { CaptureWindowService } from '../platform/capture-window-service'
import { RecognitionSessionBridge } from './recognition-session-bridge'

describe('RecognitionSessionBridge', () => {
  it('pushes matching audio chunks to the bound engine and optional side handler', () => {
    const capture = createCaptureService()
    const bridge = new RecognitionSessionBridge(capture as unknown as CaptureWindowService)
    const engine = createEngine()
    const onAudioChunk = vi.fn()
    const onCaptureEvent = vi.fn()

    bridge.bind({
      engine: engine as unknown as RecognitionEngine,
      sessionId: 'session-1',
      handlers: {
        onEngineEvent: vi.fn(),
        onCaptureEvent,
        onAudioChunk
      }
    })

    capture.emit({
      type: 'audio-chunk',
      requestId: 'session-1',
      chunk: {
        source: 'microphone',
        data: new Uint8Array([1, 2]),
        sampleRate: 16000,
        channels: 1,
        timestamp: 0
      }
    })
    capture.emit({
      type: 'audio-chunk',
      requestId: 'other',
      chunk: {
        source: 'microphone',
        data: new Uint8Array([3]),
        sampleRate: 16000,
        channels: 1,
        timestamp: 0
      }
    })
    capture.emit({
      type: 'capture-started',
      requestId: 'session-1',
      sources: ['microphone']
    })

    expect(engine.pushAudioCalls).toHaveLength(1)
    expect(onAudioChunk).toHaveBeenCalledTimes(1)
    expect(onCaptureEvent).toHaveBeenCalledWith({
      type: 'capture-started',
      requestId: 'session-1',
      sources: ['microphone']
    })

    bridge.dispose()
  })

  it('forwards engine events only while bound to that engine', () => {
    const capture = createCaptureService()
    const bridge = new RecognitionSessionBridge(capture as unknown as CaptureWindowService)
    const engine = createEngine()
    const onEngineEvent = vi.fn()

    bridge.bind({
      engine: engine as unknown as RecognitionEngine,
      sessionId: 'session-1',
      handlers: {
        onEngineEvent,
        onCaptureEvent: vi.fn()
      }
    })

    engine.emit({ type: 'session-ready' })
    bridge.clear()
    engine.emit({ type: 'session-ended' })

    expect(onEngineEvent).toHaveBeenCalledTimes(1)
    expect(onEngineEvent).toHaveBeenCalledWith({ type: 'session-ready' })
    expect(bridge.isBound).toBe(false)

    bridge.dispose()
  })

  it('rebinds the engine while keeping the same session identity and handlers', async () => {
    const capture = createCaptureService()
    const bridge = new RecognitionSessionBridge(capture as unknown as CaptureWindowService)
    const first = createEngine()
    const second = createEngine()
    const onEngineEvent = vi.fn()

    bridge.bind({
      engine: first as unknown as RecognitionEngine,
      sessionId: 'meeting-1',
      handlers: {
        onEngineEvent,
        onCaptureEvent: vi.fn()
      }
    })

    await bridge.abort({ abortCapture: false })
    bridge.rebind(second as unknown as RecognitionEngine)

    first.emit({
      type: 'warning',
      payload: { code: 'E_ENGINE_PROTOCOL', message: 'stale', recoverable: true }
    })
    second.emit({ type: 'session-ready' })

    expect(bridge.sessionId).toBe('meeting-1')
    expect(bridge.engine).toBe(second)
    expect(first.abortSessionCalls).toBe(1)
    expect(onEngineEvent).toHaveBeenCalledTimes(1)
    expect(onEngineEvent).toHaveBeenCalledWith({ type: 'session-ready' })

    bridge.dispose()
  })

  it('starts and stops capture through the bound Recognition Session', async () => {
    const capture = createCaptureService()
    const bridge = new RecognitionSessionBridge(capture as unknown as CaptureWindowService)
    const engine = createEngine()

    bridge.bind({
      engine: engine as unknown as RecognitionEngine,
      sessionId: 'ptt-1',
      handlers: {
        onEngineEvent: vi.fn(),
        onCaptureEvent: vi.fn()
      }
    })

    await bridge.start({
      mode: 'ptt',
      sources: ['microphone'],
      runtimeConfig: createRuntimeConfig(),
      microphoneDeviceId: 'mic-1'
    })

    expect(engine.startSessionCalls).toHaveLength(1)
    expect(capture.startCaptureCalls).toEqual([
      {
        requestId: 'ptt-1',
        sources: ['microphone'],
        microphoneDeviceId: 'mic-1',
        sampleRate: 16000,
        chunkMs: 100
      }
    ])

    await bridge.stopCapture()
    expect(capture.stopCaptureCalls).toEqual(['ptt-1'])

    bridge.dispose()
  })
})

function createRuntimeConfig(): ResolvedRuntimeConfig {
  return {
    engineProfile: profileCatalog[0]!,
    engineConfig: {
      mode: 'ptt',
      profileId: 'local-fast',
      preset: 'local-fast',
      language: 'auto',
      diagnosticsEnabled: true,
      experimentalFlags: []
    },
    captureConfig: {
      sampleRate: 16000,
      chunkMs: 100
    },
    outputConfig: {
      method: 'simulate_input'
    }
  }
}

function createEngine() {
  const listeners = new Set<(event: RecognitionEvent) => void>()

  return {
    pushAudioCalls: [] as unknown[],
    warmupCalls: [] as Array<{ mode: 'ptt' | 'meeting'; language: string }>,
    startSessionCalls: [] as unknown[],
    abortSessionCalls: 0,
    stopSessionCalls: 0,
    pushAudio(chunk: unknown) {
      this.pushAudioCalls.push(chunk)
    },
    async warmup(input: { mode: 'ptt' | 'meeting'; language: string }) {
      this.warmupCalls.push(input)
    },
    async startSession(input: unknown) {
      this.startSessionCalls.push(input)
    },
    async abortSession() {
      this.abortSessionCalls += 1
    },
    async stopSession() {
      this.stopSessionCalls += 1
    },
    onEvent(listener: (event: RecognitionEvent) => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    emit(event: RecognitionEvent) {
      for (const listener of listeners) {
        listener(event)
      }
    }
  }
}

function createCaptureService() {
  const listeners = new Set<(event: CaptureEvent) => void>()

  return {
    startCaptureCalls: [] as Array<Record<string, unknown>>,
    stopCaptureCalls: [] as Array<string | undefined>,
    abortCaptureCalls: [] as Array<string | undefined>,
    onEvent(listener: (event: CaptureEvent) => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    emit(event: CaptureEvent) {
      for (const listener of listeners) {
        listener(event)
      }
    },
    async startCapture(input: Record<string, unknown>) {
      this.startCaptureCalls.push(input)
      return { requestId: String(input.requestId) }
    },
    async stopCapture(sessionId?: string) {
      this.stopCaptureCalls.push(sessionId)
      return true
    },
    async abortCapture(sessionId?: string) {
      this.abortCaptureCalls.push(sessionId)
      return true
    }
  }
}
