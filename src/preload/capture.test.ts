import { describe, expect, it, vi } from 'vitest'

import { IPC_CHANNELS } from '../main/ipc/channels'
import type { CaptureCommand } from '../shared/api-types'
import { createCaptureApi } from './capture'

describe('createCaptureApi', () => {
  it('subscribes to capture commands and forwards ready/event messages', () => {
    const handlers = new Map<string, (_event: unknown, payload: unknown) => void>()
    const ipcRenderer = {
      on: vi.fn((channel: string, listener: (_event: unknown, payload: unknown) => void) => {
        handlers.set(channel, listener)
      }),
      off: vi.fn((channel: string) => {
        handlers.delete(channel)
      }),
      send: vi.fn()
    }

    const captureApi = createCaptureApi(ipcRenderer)
    const seenCommands: CaptureCommand[] = []
    const unsubscribe = captureApi.onCommand((command) => {
      seenCommands.push(command)
    })

    handlers.get(IPC_CHANNELS.captureCommand)?.({}, {
      type: 'stop',
      requestId: 'cap-1'
    } satisfies CaptureCommand)

    captureApi.notifyReady()
    captureApi.sendEvent({
      type: 'capture-stopped',
      requestId: 'cap-1'
    })
    unsubscribe()

    expect(seenCommands).toEqual([
      {
        type: 'stop',
        requestId: 'cap-1'
      }
    ])
    expect(ipcRenderer.send).toHaveBeenNthCalledWith(1, IPC_CHANNELS.captureReady)
    expect(ipcRenderer.send).toHaveBeenNthCalledWith(2, IPC_CHANNELS.captureEvent, {
      type: 'capture-stopped',
      requestId: 'cap-1'
    })
    expect(ipcRenderer.off).toHaveBeenCalledWith(IPC_CHANNELS.captureCommand, expect.any(Function))
  })
})
