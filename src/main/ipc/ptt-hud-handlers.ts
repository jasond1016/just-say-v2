import type { PttHudSnapshot } from '../../shared/api-types'
import { IPC_CHANNELS } from './channels'

export type PttHudHandlerService = {
  getSnapshot(): PttHudSnapshot
  dismiss(): Promise<void>
}

export type PttHudHandlers = {
  [IPC_CHANNELS.pttHudGetState]: () => Promise<PttHudSnapshot>
  [IPC_CHANNELS.pttHudDismiss]: () => Promise<void>
}

export function createPttHudHandlers(pttHudService: PttHudHandlerService): PttHudHandlers {
  return {
    [IPC_CHANNELS.pttHudGetState]: async () => pttHudService.getSnapshot(),
    [IPC_CHANNELS.pttHudDismiss]: async () => pttHudService.dismiss()
  }
}
