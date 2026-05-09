import type { CaptureCommand, CaptureEvent } from '../../shared/api-types'
import { IPC_CHANNELS } from '../ipc/channels'
import type { CaptureWindowTransport } from './capture-window-service'

type IpcMainListener = (_event: unknown, payload?: unknown) => void

export interface ElectronIpcMainLike {
  on(channel: string, listener: IpcMainListener): void
  off(channel: string, listener: IpcMainListener): void
}

export interface CaptureWindowWebContentsLike {
  send?: (channel: string, payload?: unknown) => void
}

export interface CaptureWindowLike {
  webContents?: CaptureWindowWebContentsLike
}

export type ElectronCaptureWindowTransportOptions = {
  readyTimeoutMs?: number
}

const DEFAULT_READY_TIMEOUT_MS = 5000

export class ElectronCaptureWindowTransport implements CaptureWindowTransport {
  private readonly listeners = new Set<(event: CaptureEvent) => void>()
  private readonly readyTimeoutMs: number
  private readonly handleReadyBound: IpcMainListener
  private readonly handleEventBound: IpcMainListener
  private captureWindow: CaptureWindowLike | null = null
  private ready = false
  private readyPromise: Promise<void> | null = null

  constructor(
    private readonly ipcMain: ElectronIpcMainLike,
    options: ElectronCaptureWindowTransportOptions = {}
  ) {
    this.readyTimeoutMs = options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS
    this.handleReadyBound = () => {
      this.ready = true
    }
    this.handleEventBound = (_event, payload) => {
      if (!payload || typeof payload !== 'object') {
        return
      }

      const captureEvent = payload as CaptureEvent
      for (const listener of this.listeners) {
        listener(captureEvent)
      }
    }

    this.ipcMain.on(IPC_CHANNELS.captureReady, this.handleReadyBound)
    this.ipcMain.on(IPC_CHANNELS.captureEvent, this.handleEventBound)
  }

  attachWindow(captureWindow: CaptureWindowLike): void {
    this.captureWindow = captureWindow
  }

  dispose(): void {
    this.ipcMain.off(IPC_CHANNELS.captureReady, this.handleReadyBound)
    this.ipcMain.off(IPC_CHANNELS.captureEvent, this.handleEventBound)
    this.listeners.clear()
    this.captureWindow = null
    this.ready = false
    this.readyPromise = null
  }

  async ensureReady(): Promise<void> {
    if (this.readyPromise) {
      return this.readyPromise
    }

    this.readyPromise = new Promise<void>((resolve, reject) => {
      const startedAt = Date.now()

      const poll = () => {
        if (this.ready && this.captureWindow?.webContents?.send) {
          resolve()
          return
        }

        if (Date.now() - startedAt >= this.readyTimeoutMs) {
          reject(new Error('Capture window did not become ready in time'))
          return
        }

        setTimeout(poll, 25)
      }

      poll()
    }).catch((error) => {
      this.readyPromise = null
      throw error
    })

    return this.readyPromise
  }

  async sendCommand(command: CaptureCommand): Promise<void> {
    await this.ensureReady()

    const webContents = this.captureWindow?.webContents

    if (!webContents?.send) {
      throw new Error('Capture window webContents is unavailable')
    }

    webContents.send(IPC_CHANNELS.captureCommand, command)
  }

  onEvent(listener: (event: CaptureEvent) => void): () => void {
    this.listeners.add(listener)

    return () => {
      this.listeners.delete(listener)
    }
  }
}
