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
  return {
    onCommand(listener) {
      const handler = (_event: unknown, payload: unknown) => {
        listener(payload as CaptureCommand)
      }

      ipcRenderer.on(IPC_CHANNELS.captureCommand, handler)

      return () => {
        ipcRenderer.off(IPC_CHANNELS.captureCommand, handler)
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
