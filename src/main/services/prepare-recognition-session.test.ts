import { describe, expect, it, vi } from 'vitest'

import type { RecognitionEngine } from '../../core/contracts/engine'
import { profileCatalog } from '../../core/settings/profile-catalog'
import type { ResolvedRuntimeConfig } from '../../shared/api-types'
import type { RecognitionSessionBridge } from './recognition-session-bridge'
import { prepareRecognitionSession } from './prepare-recognition-session'

describe('prepareRecognitionSession', () => {
  it('resolves runtime config, creates an engine, then bind+start on the Bridge', async () => {
    const runtimeConfig = createRuntimeConfig('ptt')
    const engine = { id: 'engine-1' } as unknown as RecognitionEngine
    const bridge = createBridge()
    const onPrepared = vi.fn()
    const engineFactory = vi.fn(() => engine)
    const settingsProvider = {
      resolveRuntimeConfig: vi.fn(() => runtimeConfig)
    }

    const result = await prepareRecognitionSession({
      recognitionSession: bridge as unknown as RecognitionSessionBridge,
      settingsProvider,
      engineFactory,
      mode: 'ptt',
      sessionId: 'session-1',
      handlers: {
        onEngineEvent: vi.fn(),
        onCaptureEvent: vi.fn()
      },
      start: {
        sources: ['microphone'],
        microphoneDeviceId: 'mic-1'
      },
      onPrepared
    })

    expect(settingsProvider.resolveRuntimeConfig).toHaveBeenCalledWith('ptt')
    expect(engineFactory).toHaveBeenCalledWith(runtimeConfig)
    expect(onPrepared).toHaveBeenCalledWith({ runtimeConfig, engine })
    expect(bridge.bindCalls).toHaveLength(1)
    expect(bridge.bindCalls[0]?.sessionId).toBe('session-1')
    expect(bridge.bindCalls[0]?.engine).toBe(engine)
    expect(bridge.startCalls).toEqual([
      {
        mode: 'ptt',
        sources: ['microphone'],
        runtimeConfig,
        microphoneDeviceId: 'mic-1'
      }
    ])
    expect(result).toEqual({ runtimeConfig, engine })
  })

  it('applies adaptRuntimeConfig before creating the engine', async () => {
    const base = createRuntimeConfig('meeting')
    const adapted = createRuntimeConfig('meeting')
    adapted.engineConfig = { ...adapted.engineConfig, language: 'ja' }
    const engine = { id: 'engine-2' } as unknown as RecognitionEngine
    const bridge = createBridge()
    const engineFactory = vi.fn(() => engine)

    await prepareRecognitionSession({
      recognitionSession: bridge as unknown as RecognitionSessionBridge,
      settingsProvider: {
        resolveRuntimeConfig: () => base
      },
      engineFactory,
      mode: 'meeting',
      sessionId: 'meeting-1',
      handlers: {
        onEngineEvent: vi.fn(),
        onCaptureEvent: vi.fn()
      },
      adaptRuntimeConfig: () => adapted,
      start: {
        sources: ['system'],
        explicitWarmup: true
      }
    })

    expect(engineFactory).toHaveBeenCalledWith(adapted)
    expect(bridge.startCalls[0]).toMatchObject({
      mode: 'meeting',
      sources: ['system'],
      runtimeConfig: adapted,
      explicitWarmup: true
    })
  })

  it('runs onPrepared before bind so callers can install session context first', async () => {
    const order: string[] = []
    const bridge = createBridge({
      onBind: () => {
        order.push('bind')
      },
      onStart: () => {
        order.push('start')
      }
    })

    await prepareRecognitionSession({
      recognitionSession: bridge as unknown as RecognitionSessionBridge,
      settingsProvider: {
        resolveRuntimeConfig: () => createRuntimeConfig('ptt')
      },
      engineFactory: () => ({ id: 'engine' }) as unknown as RecognitionEngine,
      mode: 'ptt',
      sessionId: 'session-1',
      handlers: {
        onEngineEvent: vi.fn(),
        onCaptureEvent: vi.fn()
      },
      start: {
        sources: ['microphone']
      },
      onPrepared: () => {
        order.push('onPrepared')
      }
    })

    expect(order).toEqual(['onPrepared', 'bind', 'start'])
  })
})

function createRuntimeConfig(mode: 'ptt' | 'meeting'): ResolvedRuntimeConfig {
  return {
    engineProfile: profileCatalog[0]!,
    engineConfig: {
      mode,
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

function createBridge(hooks: { onBind?: () => void; onStart?: () => void } = {}) {
  return {
    bindCalls: [] as Array<{ engine: unknown; sessionId: string; handlers: unknown }>,
    startCalls: [] as unknown[],
    bind(input: { engine: unknown; sessionId: string; handlers: unknown }) {
      hooks.onBind?.()
      this.bindCalls.push(input)
    },
    async start(input: unknown) {
      hooks.onStart?.()
      this.startCalls.push(input)
    }
  }
}
