import { describe, expect, it, vi } from 'vitest'

import { ElectronClipboardService } from './clipboard-service'

describe('ElectronClipboardService', () => {
  it('writes text through the injected clipboard implementation', async () => {
    const clipboardLike = {
      writeText: vi.fn()
    }

    const service = new ElectronClipboardService(clipboardLike)
    await service.writeText('hello world')

    expect(clipboardLike.writeText).toHaveBeenCalledWith('hello world')
  })
})
