import { describe, expect, it, vi } from 'vitest'

import type { PttHudSnapshot } from '../../shared/api-types'
import { PttHudWindowController } from './ptt-hud-window-controller'

describe('PttHudWindowController', () => {
  it('shows interactive recovery and hides inactive states', () => {
    const listeners = new Set<(snapshot: PttHudSnapshot) => void>()
    const window = {
      visible: false,
      showInactive: vi.fn(() => {
        window.visible = true
      }),
      show: vi.fn(() => {
        window.visible = true
      }),
      hide: vi.fn(() => {
        window.visible = false
      }),
      isVisible: vi.fn(() => window.visible),
      setIgnoreMouseEvents: vi.fn()
    }

    const controller = new PttHudWindowController(window, {
      getSnapshot: () => ({ mode: 'hidden' as const }),
      onSnapshot(listener) {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      }
    })

    emitHud(listeners, { mode: 'processing' })
    expect(window.showInactive).toHaveBeenCalledTimes(1)
    expect(window.setIgnoreMouseEvents).toHaveBeenLastCalledWith(true)

    emitHud(listeners, {
      mode: 'recovery',
      tone: 'warning' as const,
      title: 'Couldn’t type automatically',
      body: 'Copy to clipboard, then paste.',
      canCopy: true
    })
    expect(window.setIgnoreMouseEvents).toHaveBeenLastCalledWith(false)

    emitHud(listeners, { mode: 'hidden' })
    expect(window.hide).toHaveBeenCalledTimes(1)

    controller.dispose()
  })
})

function emitHud(
  listeners: Set<(snapshot: PttHudSnapshot) => void>,
  snapshot: PttHudSnapshot
): void {
  for (const listener of listeners) {
    listener(snapshot)
  }
}
