import { createHistoryHandlers } from '../ipc/history-handlers'
import { registerIpcHandlers, type IpcRegistrar } from '../ipc/register-ipc'
import { createSessionHandlers } from '../ipc/session-handlers'
import { createSettingsHandlers } from '../ipc/settings-handlers'
import { createWindows, type AppWindows, type CreateWindowsOptions } from './create-windows'
import type { HistoryHandlerService } from '../ipc/history-handlers'
import type { SessionHandlerService } from '../ipc/session-handlers'
import type { SettingsHandlerService } from '../ipc/settings-handlers'

export type CreateAppServices = {
  sessionCoordinator: SessionHandlerService
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
    createHistoryHandlers(options.services.historyService),
    createSettingsHandlers(options.services.settingsService)
  )

  const windows = await createWindows(options.windows)

  return {
    windows
  }
}
