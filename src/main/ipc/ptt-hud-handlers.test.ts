import { describe, expect, it, vi } from 'vitest'

import { IPC_CHANNELS } from './channels'
import { createPttHudHandlers } from './ptt-hud-handlers'

describe('createPttHudHandlers', () => {
  it('maps hud IPC channels to the hud service', async () => {
    const hudService = {
      getSnapshot: vi.fn().mockReturnValue({ mode: 'hidden' as const }),
      dismiss: vi.fn().mockResolvedValue(undefined)
    }

    const handlers = createPttHudHandlers(hudService)

    await expect(handlers[IPC_CHANNELS.pttHudGetState]()).resolves.toEqual({ mode: 'hidden' })
    await handlers[IPC_CHANNELS.pttHudDismiss]()

    expect(hudService.getSnapshot).toHaveBeenCalled()
    expect(hudService.dismiss).toHaveBeenCalled()
  })
})
