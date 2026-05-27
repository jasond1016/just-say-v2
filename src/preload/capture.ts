import type { CaptureCommand, CaptureEvent } from '../shared/api-types'
import { IPC_CHANNELS } from '../main/ipc/channels'

export type CaptureApi = {
  onCommand: (listener: (command: CaptureCommand) => void) => () => void
  sendEvent: (event: CaptureEvent) => void
  notifyReady: () => void
}

export type IpcRendererCaptureLike = {
  on(channel: string, listener: (_event: unknown, payload: unknown) => void): void
  off(channel: string, listener: (_event: unknown, payload: unknown) => void): void
  send(channel: string, payload?: unknown): void
}

export function createCaptureApi(ipcRenderer: IpcRendererCaptureLike): CaptureApi {
  // Use a single persistent IPC handler to avoid contextBridge issues with off()
  let activeListener: ((command: CaptureCommand) => void) | null = null

  ipcRenderer.on(IPC_CHANNELS.captureCommand, (_event: unknown, payload: unknown) => {
    activeListener?.(payload as CaptureCommand)
  })

  return {
    onCommand(listener) {
      activeListener = listener

      return () => {
        if (activeListener === listener) {
          activeListener = null
        }
      }
    },
    sendEvent(event) {
      ipcRenderer.send(IPC_CHANNELS.captureEvent, event)
    },
    notifyReady() {
      ipcRenderer.send(IPC_CHANNELS.captureReady)
    }
  }
}
