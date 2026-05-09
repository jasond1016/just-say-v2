import { api, createAppApi } from './api'
import { createCaptureApi } from './capture'

export type ContextBridgeLike = {
  exposeInMainWorld(key: string, api: unknown): void
}

export type IpcRendererLike = {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>
  on(channel: string, listener: (_event: unknown, payload: unknown) => void): void
  off(channel: string, listener: (_event: unknown, payload: unknown) => void): void
  send(channel: string, payload?: unknown): void
}

export function installPreloadBridge(
  contextBridge: ContextBridgeLike,
  ipcRenderer: IpcRendererLike
): void {
  contextBridge.exposeInMainWorld(
    'justSay',
    createAppApi(<TResult>(channel: string, ...args: unknown[]) =>
      ipcRenderer.invoke(channel, ...args) as Promise<TResult>
    )
  )
  contextBridge.exposeInMainWorld('justSayCapture', createCaptureApi(ipcRenderer))
}

export { api }
