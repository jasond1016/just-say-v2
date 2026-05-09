import { describe, expect, it, vi } from 'vitest'

import { registerElectronDisplayMediaHandler } from './electron-display-media-handler'

describe('registerElectronDisplayMediaHandler', () => {
  it('registers a handler that grants the first screen source with loopback audio', async () => {
    let registeredHandler:
      | ((_request: unknown, callback: (grant: { video?: unknown; audio?: 'loopback' }) => void) => void | Promise<void>)
      | undefined
    let registeredOptions: { useSystemPicker?: boolean } | undefined
    const source = { id: 'screen:1' }
    const session = {
      setDisplayMediaRequestHandler: vi.fn((handler, options) => {
        registeredHandler = handler
        registeredOptions = options
      })
    }
    const capturer = {
      getSources: vi.fn(async () => [source])
    }

    registerElectronDisplayMediaHandler(session, capturer)

    expect(session.setDisplayMediaRequestHandler).toHaveBeenCalledTimes(1)
    expect(registeredOptions).toEqual({
      useSystemPicker: false
    })

    const callback = vi.fn()
    await registeredHandler?.({}, callback)

    expect(capturer.getSources).toHaveBeenCalledWith({
      types: ['screen'],
      thumbnailSize: {
        width: 0,
        height: 0
      }
    })
    expect(callback).toHaveBeenCalledWith({
      video: source,
      audio: 'loopback'
    })
  })

  it('denies the request when no screen source is available', async () => {
    let registeredHandler:
      | ((_request: unknown, callback: (grant: { video?: unknown; audio?: 'loopback' }) => void) => void | Promise<void>)
      | undefined
    const session = {
      setDisplayMediaRequestHandler: vi.fn((handler) => {
        registeredHandler = handler
      })
    }
    const capturer = {
      getSources: vi.fn(async () => [])
    }

    registerElectronDisplayMediaHandler(session, capturer)

    const callback = vi.fn()
    await registeredHandler?.({}, callback)

    expect(callback).toHaveBeenCalledWith({})
  })
})
