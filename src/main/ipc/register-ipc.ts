export type Handler = (...args: unknown[]) => Promise<unknown>

export interface IpcRegistrar {
  handle(channel: string, handler: Handler): void
}

export function registerIpcHandlers(
  registrar: IpcRegistrar,
  ...handlerGroups: Array<Record<string, (...args: never[]) => Promise<unknown>>>
): void {
  for (const handlerGroup of handlerGroups) {
    for (const [channel, handler] of Object.entries(handlerGroup)) {
      registrar.handle(channel, handler as Handler)
    }
  }
}
