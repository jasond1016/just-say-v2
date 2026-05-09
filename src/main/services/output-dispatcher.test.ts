import { describe, expect, it, vi } from 'vitest'

import { OutputDispatcher } from './output-dispatcher'

describe('OutputDispatcher', () => {
  it('delivers clipboard and popup output to the matching target', async () => {
    const clipboard = {
      writeText: vi.fn().mockResolvedValue(undefined)
    }
    const popup = {
      showText: vi.fn().mockResolvedValue(undefined)
    }
    const dispatcher = new OutputDispatcher({ clipboard, popup })

    await expect(dispatcher.deliver({ text: 'hello', method: 'clipboard' })).resolves.toEqual({
      methodUsed: 'clipboard'
    })
    await expect(dispatcher.deliver({ text: 'world', method: 'popup' })).resolves.toEqual({
      methodUsed: 'popup'
    })

    expect(clipboard.writeText).toHaveBeenCalledWith('hello')
    expect(popup.showText).toHaveBeenCalledWith('world')
  })

  it('falls back to clipboard when simulate_input is unavailable', async () => {
    const clipboard = {
      writeText: vi.fn().mockResolvedValue(undefined)
    }
    const popup = {
      showText: vi.fn().mockResolvedValue(undefined)
    }
    const dispatcher = new OutputDispatcher({ clipboard, popup })

    await expect(dispatcher.deliver({ text: 'fallback text', method: 'simulate_input' })).resolves.toEqual({
      methodUsed: 'clipboard'
    })
    expect(clipboard.writeText).toHaveBeenCalledWith('fallback text')
  })

  it('uses the input target when simulate_input succeeds', async () => {
    const clipboard = {
      writeText: vi.fn().mockResolvedValue(undefined)
    }
    const popup = {
      showText: vi.fn().mockResolvedValue(undefined)
    }
    const input = {
      sendText: vi.fn().mockResolvedValue(undefined)
    }
    const dispatcher = new OutputDispatcher({ clipboard, popup, input })

    await expect(dispatcher.deliver({ text: 'typed text', method: 'simulate_input' })).resolves.toEqual({
      methodUsed: 'simulate_input'
    })
    expect(input.sendText).toHaveBeenCalledWith('typed text')
    expect(clipboard.writeText).not.toHaveBeenCalled()
  })
})
