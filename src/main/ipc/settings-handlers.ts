import type { AppSettings, SettingsPatch } from '../../shared/api-types'
import { IPC_CHANNELS } from './channels'

export type SettingsHandlerService = {
  getSettings(): Promise<AppSettings>
  updateSettings(patch: SettingsPatch): Promise<AppSettings>
}

export type SettingsHandlers = {
  [IPC_CHANNELS.settingsGet]: () => Promise<AppSettings>
  [IPC_CHANNELS.settingsUpdate]: (patch: SettingsPatch) => Promise<AppSettings>
}

export function createSettingsHandlers(settingsService: SettingsHandlerService): SettingsHandlers {
  return {
    [IPC_CHANNELS.settingsGet]: async () => settingsService.getSettings(),
    [IPC_CHANNELS.settingsUpdate]: async (patch) => settingsService.updateSettings(patch)
  }
}
