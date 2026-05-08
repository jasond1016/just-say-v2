import { describe, expect, it, vi } from 'vitest'

import { IPC_CHANNELS } from '../main/ipc/channels'
import type { AppApi } from './api'
import { installPreloadBridge } from './index'

describe('installPreloadBridge', () => {
  it('exposes the typed app api on the expected window key', async () => {
    const exposeInMainWorld = vi.fn()
    const invoke = vi.fn(async () => undefined)

    installPreloadBridge(
      {
        exposeInMainWorld
      },
      {
        invoke
      }
    )

    expect(exposeInMainWorld).toHaveBeenCalledTimes(1)
    expect(exposeInMainWorld.mock.calls[0]?.[0]).toBe('justSay')

    const exposedApi = exposeInMainWorld.mock.calls[0]?.[1] as AppApi
    await exposedApi.getRuntime()

    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.sessionGetRuntime)
  })
})
