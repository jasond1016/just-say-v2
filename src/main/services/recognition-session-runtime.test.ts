import { describe, expect, it, vi } from 'vitest'

import { profileCatalog } from '../../core/settings/profile-catalog'
import type { RecognitionEngine, RecognitionEvent } from '../../core/contracts/engine'
import type { ResolvedRuntimeConfig } from '../../shared/api-types'
import type { CaptureWindowService } from '../platform/capture-window-service'
import {
  abortRecognitionSession,
  attachRecognitionEngine,
  buildStartSessionInput,
  normalizeRecognitionError,
  startRecognitionSession
} from './recognition-session-runtime'

describe('recognition-session-runtime', () => {
  it('builds start-session input with translation settings from runtime config', () => {
    expect(
      buildStartSessionInput({
        sessionId: 'session-1',
        mode: 'meeting',
        sources: ['system', 'microphone'],
        runtimeConfig: createRuntimeConfig({
          translationConfig: {
            provider: 'openai-compatible',
            targetLanguage: 'en',
            sourceLanguage: 'auto',
            credentials: { translationApiKey: 'test-key' }
          }
        })
      })
    ).toEqual({
      sessionId: 'session-1',
      mode: 'meeting',
      sources: ['system', 'microphone'],
      language: 'auto',
      translation: {
        enabled: false,
        targetLanguage: 'en'
      }
    })
  })

  it('attaches engine events to the provided handler', () => {
    const engine = createEngine()
    const onEvent = vi.fn()
    const seen: RecognitionEvent[] = []

    const unsubscribe = attachRecognitionEngine(engine, (event) => {
      seen.push(event)
      onEvent(event)
    })

    engine.emit({ type: 'session-ready' })
    unsubscribe()
    engine.emit({ type: 'session-ended' })

    expect(onEvent).toHaveBeenCalledTimes(1)
    expect(seen).toEqual([{ type: 'session-ready' }])
  })

  it('starts ptt sessions through startSession then capture', async () => {
    const engine = createEngine()
    const captureWindowService = createCaptureWindowService()

    await startRecognitionSession({
      engine,
      captureWindowService,
      sessionId: 'ptt-1',
      mode: 'ptt',
      sources: ['microphone'],
      runtimeConfig: createRuntimeConfig(),
      microphoneDeviceId: 'mic-1'
    })

    expect(engine.warmupCalls).toEqual([])
    expect(engine.startSessionCalls).toHaveLength(1)
    expect(captureWindowService.startCaptureCalls).toEqual([
      {
        requestId: 'ptt-1',
        sources: ['microphone'],
        microphoneDeviceId: 'mic-1',
        sampleRate: 16000,
        chunkMs: 100
      }
    ])
  })

  it('starts meeting sessions with explicit warmup before capture', async () => {
    const engine = createEngine()
    const captureWindowService = createCaptureWindowService()

    await startRecognitionSession({
      engine,
      captureWindowService,
      sessionId: 'meeting-1',
      mode: 'meeting',
      sources: ['system'],
      runtimeConfig: createRuntimeConfig(),
      explicitWarmup: true,
      startCapture: true
    })

    expect(engine.warmupCalls).toEqual([{ mode: 'meeting', language: 'auto' }])
    expect(engine.startSessionCalls).toHaveLength(1)
    expect(captureWindowService.startCaptureCalls).toHaveLength(1)
  })

  it('can restart meeting engine sessions without restarting capture', async () => {
    const engine = createEngine()
    const captureWindowService = createCaptureWindowService()

    await startRecognitionSession({
      engine,
      captureWindowService,
      sessionId: 'meeting-1',
      mode: 'meeting',
      sources: ['system', 'microphone'],
      runtimeConfig: createRuntimeConfig(),
      microphoneDeviceId: 'mic-1',
      explicitWarmup: true,
      startCapture: false
    })

    expect(engine.startSessionCalls).toHaveLength(1)
    expect(captureWindowService.startCaptureCalls).toEqual([])
  })

  it('aborts engine and capture best-effort', async () => {
    const engine = createEngine()
    const captureWindowService = createCaptureWindowService()

    await abortRecognitionSession({
      engine,
      captureWindowService,
      sessionId: 'session-1'
    })

    expect(engine.abortSessionCalls).toBe(1)
    expect(captureWindowService.abortCaptureCalls).toEqual(['session-1'])
  })

  it('can abort only the engine during recovery', async () => {
    const engine = createEngine()
    const captureWindowService = createCaptureWindowService()

    await abortRecognitionSession({
      engine,
      captureWindowService,
      sessionId: 'session-1',
      abortCapture: false
    })

    expect(engine.abortSessionCalls).toBe(1)
    expect(captureWindowService.abortCaptureCalls).toEqual([])
  })

  it('normalizes structured recognition errors', () => {
    expect(
      normalizeRecognitionError(
        Object.assign(new Error('boom'), {
          payload: {
            code: 'E_ENGINE_UNAVAILABLE',
            message: 'Engine down',
            retryable: true
          }
        })
      )
    ).toEqual({
      code: 'E_ENGINE_UNAVAILABLE',
      message: 'Engine down',
      retryable: true
    })
  })
})

function createRuntimeConfig(
  overrides: Partial<ResolvedRuntimeConfig> = {}
): ResolvedRuntimeConfig {
  return {
    engineProfile: profileCatalog[0]!,
    engineConfig: {
      mode: 'meeting',
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
    },
    ...overrides
  }
}

function createEngine() {
  const listeners = new Set<(event: RecognitionEvent) => void>()

  const engine = {
    warmupCalls: [] as Array<{ mode: 'ptt' | 'meeting'; language: string }>,
    startSessionCalls: [] as Array<unknown>,
    abortSessionCalls: 0,
    async warmup(input: { mode: 'ptt' | 'meeting'; language: string }) {
      this.warmupCalls.push(input)
    },
    async startSession(input: unknown) {
      this.startSessionCalls.push(input)
    },
    async abortSession() {
      this.abortSessionCalls += 1
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

  // Test double only implements the subset of RecognitionEngine exercised here.
  return engine as unknown as RecognitionEngine & typeof engine
}

function createCaptureWindowService() {
  const service = {
    startCaptureCalls: [] as Array<Record<string, unknown>>,
    abortCaptureCalls: [] as Array<string | undefined>,
    async startCapture(input: Record<string, unknown>) {
      this.startCaptureCalls.push(input)
      return {
        requestId: String(input.requestId)
      }
    },
    async abortCapture(sessionId?: string) {
      this.abortCaptureCalls.push(sessionId)
      return true
    }
  }

  // Test double only implements the subset of CaptureWindowService exercised here.
  return service as unknown as CaptureWindowService & typeof service
}
