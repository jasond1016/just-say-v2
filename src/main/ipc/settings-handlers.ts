import type { AppSettings, SettingsPatch, TranslationCredentialsInput } from '../../shared/api-types'
import { IPC_CHANNELS } from './channels'

export type SettingsHandlerService = {
  getSettings(): Promise<AppSettings>
  updateSettings(patch: SettingsPatch): Promise<AppSettings>
  saveTranslationCredentials?(input: TranslationCredentialsInput): Promise<AppSettings>
}

export type SettingsHandlers = {
  [IPC_CHANNELS.settingsGet]: () => Promise<AppSettings>
  [IPC_CHANNELS.settingsUpdate]: (patch: SettingsPatch) => Promise<AppSettings>
  [IPC_CHANNELS.settingsSaveTranslationCredentials]: (
    input: TranslationCredentialsInput
  ) => Promise<AppSettings>
}

export function createSettingsHandlers(settingsService: SettingsHandlerService): SettingsHandlers {
  return {
    [IPC_CHANNELS.settingsGet]: async () => settingsService.getSettings(),
    [IPC_CHANNELS.settingsUpdate]: async (patch) => settingsService.updateSettings(patch),
    [IPC_CHANNELS.settingsSaveTranslationCredentials]: async (input) => {
      if (!settingsService.saveTranslationCredentials) {
        throw new Error('Saving translation credentials is not supported')
      }

      return settingsService.saveTranslationCredentials(input)
    }
  }
}
