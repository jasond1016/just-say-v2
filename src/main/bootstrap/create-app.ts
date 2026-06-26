import type { AppSettings } from '../../shared/api-types'
import { createDiagnosticsHandlers } from '../ipc/diagnostics-handlers'
import { createHistoryHandlers } from '../ipc/history-handlers'
import { IPC_CHANNELS } from '../ipc/channels'
import { createPttHudHandlers } from '../ipc/ptt-hud-handlers'
import { registerIpcHandlers, type IpcRegistrar } from '../ipc/register-ipc'
import { createSessionHandlers } from '../ipc/session-handlers'
import { createSettingsHandlers } from '../ipc/settings-handlers'
import { createSpeechHandlers } from '../ipc/speech-handlers'
import type { SessionService } from '../services/session-service'
import type { SpeechRuntime } from '../services/speech-runtime'
import { createWindows, type AppWindows, type CreateWindowsOptions } from './create-windows'
import type { DiagnosticsHandlerService } from '../ipc/diagnostics-handlers'
import type { HistoryHandlerService } from '../ipc/history-handlers'
import type { PttHudHandlerService } from '../ipc/ptt-hud-handlers'
import type { SettingsHandlerService } from '../ipc/settings-handlers'

export type CreateAppServices = {
  sessionService: SessionService
  speechService: SpeechRuntime
  historyService: HistoryHandlerService
  pttHudService: PttHudHandlerService & {
    onSnapshot(listener: (snapshot: ReturnType<PttHudHandlerService['getSnapshot']>) => void): () => void
  }
  settingsService: SettingsHandlerService & {
    saveTranslationCredentials?(input: { apiKey: string }): Promise<AppSettings>
    onChanged?(listener: (settings: AppSettings) => void): () => void
  }
  diagnosticsService: DiagnosticsHandlerService
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
    createSessionHandlers(options.services.sessionService),
    createPttHudHandlers(options.services.pttHudService),
    createSpeechHandlers(options.services.speechService),
    createHistoryHandlers(options.services.historyService),
    createSettingsHandlers(options.services.settingsService),
    createDiagnosticsHandlers(options.services.diagnosticsService)
  )

  const windows = await createWindows(options.windows)
  const initialSnapshot = options.services.sessionService.getRuntimeSnapshot()
  windows.mainWindow.webContents?.send?.(IPC_CHANNELS.runtimeSnapshot, initialSnapshot)
  options.services.sessionService.onSnapshot((snapshot) => {
    windows.mainWindow.webContents?.send?.(IPC_CHANNELS.runtimeSnapshot, snapshot)
  })
  options.services.sessionService.onNotification((notification) => {
    windows.mainWindow.webContents?.send?.(IPC_CHANNELS.runtimeNotification, notification)
  })
  const initialHudSnapshot = options.services.pttHudService.getSnapshot()
  windows.hudWindow.webContents?.send?.(IPC_CHANNELS.pttHudSnapshot, initialHudSnapshot)
  options.services.pttHudService.onSnapshot((snapshot) => {
    windows.hudWindow.webContents?.send?.(IPC_CHANNELS.pttHudSnapshot, snapshot)
  })
  options.services.settingsService.onChanged?.((settings) => {
    windows.mainWindow.webContents?.send?.(IPC_CHANNELS.settingsChanged, settings)
    windows.hudWindow.webContents?.send?.(IPC_CHANNELS.settingsChanged, settings)
  })

  return {
    windows
  }
}
