import { describe, expect, it } from 'vitest'

import type { CaptureCommand, CaptureEvent } from '../../shared/api-types'
import { IPC_CHANNELS } from '../ipc/channels'
import { ElectronCaptureWindowTransport } from './electron-capture-window-transport'

describe('ElectronCaptureWindowTransport', () => {
  it('waits for the capture window to attach and report ready before sending commands', async () => {
    const ipcMain = createFakeIpcMain()
    const sentCommands: Array<{ channel: string; payload?: unknown }> = []
    const transport = new ElectronCaptureWindowTransport(ipcMain, {
      readyTimeoutMs: 200
    })

    transport.attachWindow({
      webContents: {
        send(channel, payload) {
          sentCommands.push({ channel, payload })
        }
      }
    })

    const sendPromise = transport.sendCommand({
      type: 'start',
      requestId: 'cap-1',
      sources: ['microphone'],
      sampleRate: 16000,
      chunkMs: 100
    })

    ipcMain.emit(IPC_CHANNELS.captureReady)
    await sendPromise

    expect(sentCommands).toEqual([
      {
        channel: IPC_CHANNELS.captureCommand,
        payload: {
          type: 'start',
          requestId: 'cap-1',
          sources: ['microphone'],
          sampleRate: 16000,
          chunkMs: 100
        }
      }
    ])
  })

  it('forwards capture events to listeners', () => {
    const ipcMain = createFakeIpcMain()
    const transport = new ElectronCaptureWindowTransport(ipcMain)
    const seenEvents: CaptureEvent[] = []

    transport.onEvent((event) => {
      seenEvents.push(event)
    })

    ipcMain.emit(IPC_CHANNELS.captureEvent, {
      type: 'capture-stopped',
      requestId: 'cap-2'
    } satisfies CaptureEvent)

    expect(seenEvents).toEqual([
      {
        type: 'capture-stopped',
        requestId: 'cap-2'
      }
    ])
  })

  it('times out when the capture window never becomes ready', async () => {
    const ipcMain = createFakeIpcMain()
    const transport = new ElectronCaptureWindowTransport(ipcMain, {
      readyTimeoutMs: 10
    })

    transport.attachWindow({
      webContents: {
        send() {}
      }
    })

    await expect(transport.ensureReady()).rejects.toThrow('Capture window did not become ready in time')
  })
})

function createFakeIpcMain() {
  const listeners = new Map<string, Set<(_event: unknown, payload?: unknown) => void>>()

  return {
    on(channel: string, listener: (_event: unknown, payload?: unknown) => void) {
      const bucket = listeners.get(channel) ?? new Set()
      bucket.add(listener)
      listeners.set(channel, bucket)
    },
    off(channel: string, listener: (_event: unknown, payload?: unknown) => void) {
      listeners.get(channel)?.delete(listener)
    },
    emit(channel: string, payload?: CaptureEvent | CaptureCommand) {
      for (const listener of listeners.get(channel) ?? []) {
        listener({}, payload)
      }
    }
  }
}
