import { describe, expect, it } from 'vitest'

import { createElectronIpcRegistrar } from './electron-ipc'

describe('createElectronIpcRegistrar', () => {
  it('adapts ipcMain.handle to the generic registrar shape', async () => {
    const registrations: Array<{
      channel: string
      listener: (event: unknown, ...args: unknown[]) => Promise<unknown> | unknown
    }> = []

    const registrar = createElectronIpcRegistrar({
      handle(channel, listener) {
        registrations.push({ channel, listener })
      }
    })

    registrar.handle('history.list', async (query) => ({ query }))

    expect(registrations).toHaveLength(1)
    await expect(registrations[0]?.listener({}, { page: 2 })).resolves.toEqual({
      query: { page: 2 }
    })
  })
})
