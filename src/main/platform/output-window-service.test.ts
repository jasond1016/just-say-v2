import { describe, expect, it, vi } from 'vitest'

import { OutputWindowService } from './output-window-service'

describe('OutputWindowService', () => {
  it('loads popup content and shows the output window', async () => {
    const window = {
      loadURL: vi.fn().mockResolvedValue(undefined),
      show: vi.fn(),
      focus: vi.fn()
    }
    const service = new OutputWindowService(() => window)

    await service.showText('hello <world>')

    expect(window.loadURL).toHaveBeenCalledWith(expect.stringContaining('hello%20%26lt%3Bworld%26gt%3B'))
    expect(window.show).toHaveBeenCalledTimes(1)
    expect(window.focus).toHaveBeenCalledTimes(1)
  })
})
