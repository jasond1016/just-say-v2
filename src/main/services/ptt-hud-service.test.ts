import { describe, expect, it, vi } from 'vitest'

import type { AppRuntimeSnapshot } from '../../shared/api-types'
import { PttHudService } from './ptt-hud-service'

describe('PttHudService', () => {
  it('moves through recording, processing, sent, and hidden states', () => {
    vi.useFakeTimers()
    let now = 1_000
    const runtime = createRuntimeSnapshot()
    const listeners = new Set<(snapshot: AppRuntimeSnapshot) => void>()
    const service = new PttHudService(
      {
        getRuntimeSnapshot: () => runtime.current,
        onSnapshot(listener) {
          listeners.add(listener)
          return () => {
            listeners.delete(listener)
          }
        },
        copyLatestPttText: vi.fn().mockResolvedValue(undefined)
      },
      {
        now: () => now
      }
    )

    runtime.current = {
      ...runtime.current,
      ptt: {
        status: 'capturing'
      }
    }
    emitRuntime(listeners, runtime.current)
    now = 3_400
    vi.advanceTimersByTime(250)

    expect(service.getSnapshot()).toEqual({
      mode: 'recording',
      elapsedMs: 2_400
    })

    runtime.current = {
      ...runtime.current,
      ptt: {
        status: 'recognizing'
      }
    }
    emitRuntime(listeners, runtime.current)
    expect(service.getSnapshot()).toEqual({
      mode: 'processing'
    })

    runtime.current = {
      ...runtime.current,
      ptt: {
        status: 'completed',
        lastResult: {
          text: 'hello',
          deliveredAt: 4_000,
          deliveryMethod: 'simulate_input'
        }
      }
    }
    emitRuntime(listeners, runtime.current)
    expect(service.getSnapshot()).toEqual({
      mode: 'sent'
    })

    runtime.current = {
      ...runtime.current,
      ptt: {
        status: 'idle',
        lastResult: {
          text: 'hello',
          deliveredAt: 4_000,
          deliveryMethod: 'simulate_input'
        }
      }
    }
    emitRuntime(listeners, runtime.current)
    vi.advanceTimersByTime(820)

    expect(service.getSnapshot()).toEqual({
      mode: 'hidden'
    })

    service.dispose()
    vi.useRealTimers()
  })

  it('suppresses a dismissed recovery strip until the next attempt', async () => {
    const runtime = createRuntimeSnapshot({
      ptt: {
        status: 'idle',
        error: {
          code: 'E_OUTPUT_DELIVERY',
          message: 'Could not type',
          retryable: true
        }
      }
    })
    const listeners = new Set<(snapshot: AppRuntimeSnapshot) => void>()
    const service = new PttHudService({
      getRuntimeSnapshot: () => runtime.current,
      onSnapshot(listener) {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },
      copyLatestPttText: vi.fn().mockResolvedValue(undefined)
    })

    expect(service.getSnapshot()).toEqual({
      mode: 'recovery',
      tone: 'warning',
      title: 'Couldn’t type automatically',
      body: 'Copy to clipboard, then paste.',
      canCopy: true
    })

    await service.dismiss()
    expect(service.getSnapshot()).toEqual({
      mode: 'hidden'
    })

    emitRuntime(listeners, runtime.current)
    expect(service.getSnapshot()).toEqual({
      mode: 'hidden'
    })

    runtime.current = {
      ...runtime.current,
      ptt: {
        status: 'capturing'
      }
    }
    emitRuntime(listeners, runtime.current)
    runtime.current = {
      ...runtime.current,
      ptt: {
        status: 'idle',
        error: {
          code: 'E_OUTPUT_DELIVERY',
          message: 'Could not type',
          retryable: true
        }
      }
    }
    emitRuntime(listeners, runtime.current)

    expect(service.getSnapshot()).toEqual({
      mode: 'recovery',
      tone: 'warning',
      title: 'Couldn’t type automatically',
      body: 'Copy to clipboard, then paste.',
      canCopy: true
    })

    service.dispose()
  })
})

function createRuntimeSnapshot(
  overrides: Partial<AppRuntimeSnapshot> = {}
): { current: AppRuntimeSnapshot } {
  return {
    current: {
      ptt: {
        status: 'idle'
      },
      liveSession: null,
      services: {
        localService: 'healthy'
      },
      ...overrides
    }
  }
}

function emitRuntime(
  listeners: Set<(snapshot: AppRuntimeSnapshot) => void>,
  snapshot: AppRuntimeSnapshot
): void {
  for (const listener of listeners) {
    listener(snapshot)
  }
}
