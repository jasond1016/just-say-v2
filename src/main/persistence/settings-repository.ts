import type { AppSettings } from '../../shared/api-types'
import { createDefaultSettings } from '../../core/settings/settings-schema'

export interface SettingsRepository {
  get(): Promise<AppSettings | null>
  save(settings: AppSettings): Promise<void>
}

export class InMemorySettingsRepository implements SettingsRepository {
  private settings: AppSettings | null = null

  async get(): Promise<AppSettings | null> {
    return this.settings ? cloneSettings(this.settings) : null
  }

  async save(settings: AppSettings): Promise<void> {
    this.settings = cloneSettings(settings)
  }
}

export function cloneSettings(settings: AppSettings): AppSettings {
  const defaults = createDefaultSettings()

  return {
    general: {
      ...defaults.general,
      ...settings.general
    },
    speech: {
      ...defaults.speech,
      ...settings.speech
    },
    input: {
      ...defaults.input,
      ...settings.input
    },
    output: {
      ...defaults.output,
      ...settings.output
    },
    translation: {
      ...defaults.translation,
      ...settings.translation
    },
    advanced: {
      ...defaults.advanced,
      ...settings.advanced,
      experimentalFlags: [...settings.advanced.experimentalFlags]
    }
  }
}
