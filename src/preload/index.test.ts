import { describe, expect, it, vi } from 'vitest'

import { IPC_CHANNELS } from '../main/ipc/channels'
import type { AppApi } from './api'
import type { CaptureApi } from './capture'
import { installPreloadBridge } from './index'

describe('installPreloadBridge', () => {
  it('exposes the typed app api and capture bridge on the expected window keys', async () => {
    const exposeInMainWorld = vi.fn()
    const invoke = vi.fn(async () => undefined)
    const on = vi.fn()
    const off = vi.fn()
    const send = vi.fn()

    installPreloadBridge(
      {
        exposeInMainWorld
      },
      {
        invoke,
        on,
        off,
        send
      }
    )

    expect(exposeInMainWorld).toHaveBeenCalledTimes(2)
    expect(exposeInMainWorld.mock.calls[0]?.[0]).toBe('justSay')
    expect(exposeInMainWorld.mock.calls[1]?.[0]).toBe('justSayCapture')

    const exposedApi = exposeInMainWorld.mock.calls[0]?.[1] as AppApi
    await exposedApi.getRuntime()
    const unsubscribe = exposedApi.onRuntimeSnapshot(() => {})
    await exposedApi.getPttHudState()
    const unsubscribeHud = exposedApi.onPttHudState(() => {})
    const captureApi = exposeInMainWorld.mock.calls[1]?.[1] as CaptureApi
    captureApi.notifyReady()
    unsubscribe()
    unsubscribeHud()

    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.sessionGetRuntime)
    expect(invoke).toHaveBeenCalledWith(IPC_CHANNELS.pttHudGetState)
    expect(on).toHaveBeenCalledWith(IPC_CHANNELS.runtimeSnapshot, expect.any(Function))
    expect(off).toHaveBeenCalledWith(IPC_CHANNELS.runtimeSnapshot, expect.any(Function))
    expect(on).toHaveBeenCalledWith(IPC_CHANNELS.pttHudSnapshot, expect.any(Function))
    expect(off).toHaveBeenCalledWith(IPC_CHANNELS.pttHudSnapshot, expect.any(Function))
    expect(send).toHaveBeenCalledWith(IPC_CHANNELS.captureReady)
  })
})
