import { createHistoryHandlers } from '../ipc/history-handlers'
import { IPC_CHANNELS } from '../ipc/channels'
import { registerIpcHandlers, type IpcRegistrar } from '../ipc/register-ipc'
import { createSessionHandlers } from '../ipc/session-handlers'
import { createSettingsHandlers } from '../ipc/settings-handlers'
import { createSpeechHandlers } from '../ipc/speech-handlers'
import { createWindows, type AppWindows, type CreateWindowsOptions } from './create-windows'
import type { HistoryHandlerService } from '../ipc/history-handlers'
import type { SessionHandlerService } from '../ipc/session-handlers'
import type { SettingsHandlerService } from '../ipc/settings-handlers'
import type { SpeechHandlerService } from '../ipc/speech-handlers'

export type CreateAppServices = {
  sessionCoordinator: SessionHandlerService & {
    onSnapshot(listener: (snapshot: ReturnType<SessionHandlerService['getRuntimeSnapshot']>) => void): () => void
  }
  speechService: SpeechHandlerService
  historyService: HistoryHandlerService
  settingsService: SettingsHandlerService
}

export type CreateAppOptions = {
  registrar: IpcRegistrar
  services: CreateAppServices
  windows: CreateWindowsOptions
}

export type AppBootstrap = {
  windows: AppWindows
}

export async function createApp(options: CreateAppOptions): Promise<AppBootstrap> {
  registerIpcHandlers(
    options.registrar,
    createSessionHandlers(options.services.sessionCoordinator),
    createSpeechHandlers(options.services.speechService),
    createHistoryHandlers(options.services.historyService),
    createSettingsHandlers(options.services.settingsService)
  )

  const windows = await createWindows(options.windows)
  const initialSnapshot = options.services.sessionCoordinator.getRuntimeSnapshot()
  windows.mainWindow.webContents?.send?.(IPC_CHANNELS.runtimeSnapshot, initialSnapshot)
  options.services.sessionCoordinator.onSnapshot((snapshot) => {
    windows.mainWindow.webContents?.send?.(IPC_CHANNELS.runtimeSnapshot, snapshot)
  })

  return {
    windows
  }
}
