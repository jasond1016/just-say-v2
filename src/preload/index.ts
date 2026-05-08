import { api, createAppApi } from './api'

export type ContextBridgeLike = {
  exposeInMainWorld(key: string, api: unknown): void
}

export type IpcRendererLike = {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>
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
}

export { api }
