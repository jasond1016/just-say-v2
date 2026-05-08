import type { IpcRegistrar } from './register-ipc'

export type ElectronLikeIpcMain = {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => Promise<unknown> | unknown): void
}

export function createElectronIpcRegistrar(ipcMain: ElectronLikeIpcMain): IpcRegistrar {
  return {
    handle(channel, handler) {
      ipcMain.handle(channel, async (_event, ...args) => handler(...args))
    }
  }
}
