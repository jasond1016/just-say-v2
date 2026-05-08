import { describe, expect, it, vi } from 'vitest'

import { wireAppLifecycle } from './lifecycle'

describe('wireAppLifecycle', () => {
  it('waits for app readiness, runs bootstrap, and wires window close handling', async () => {
    let closedHandler: (() => void) | undefined
    const app = {
      whenReady: vi.fn().mockResolvedValue(undefined),
      on: vi.fn((event: 'window-all-closed', listener: () => void) => {
        if (event === 'window-all-closed') {
          closedHandler = listener
        }
      }),
      quit: vi.fn()
    }
    const onReady = vi.fn().mockResolvedValue(undefined)

    await wireAppLifecycle(app, { onReady })

    expect(app.whenReady).toHaveBeenCalled()
    expect(onReady).toHaveBeenCalled()

    closedHandler?.()
    expect(app.quit).toHaveBeenCalled()
  })
})
