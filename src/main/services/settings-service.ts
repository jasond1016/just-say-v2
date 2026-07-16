import type { AppSettings, ResolvedRuntimeConfig, SettingsPatch } from '../../shared/api-types'
import type { SessionMode } from '../../shared/primitive-types'
import type { SettingsRepository } from '../persistence/settings-repository'
import {
  applySettingsPatch,
  createDefaultSettings,
  normalizeSettings
} from '../../core/settings/settings-schema'
import { getExposedProfileById } from '../../core/settings/profile-catalog'
import {
  resolveRuntimeConfig,
  type PlatformCapabilities,
  type ResolverCredentials
} from '../../core/settings/settings-resolver'

export type SettingsServiceOptions = {
  platformProvider?: () => Partial<PlatformCapabilities> | undefined
}

export class SettingsService {
  private readonly listeners = new Set<(settings: AppSettings) => void>()

  constructor(
    private readonly repository: SettingsRepository,
    private readonly options: SettingsServiceOptions = {}
  ) {}

  async getSettings(): Promise<AppSettings> {
    const stored = await this.repository.get()
    const normalized = stored ? normalizeSettings(stored) : createDefaultSettings()
    return normalizeExposedSettings(normalized)
  }

  async updateSettings(patch: SettingsPatch): Promise<AppSettings> {
    const current = await this.getSettings()
    const next = normalizeExposedSettings(applySettingsPatch(current, patch))
    await this.repository.save(next)
    this.emitChanged(next)
    return next
  }

  onChanged(listener: (settings: AppSettings) => void): () => void {
    this.listeners.add(listener)

    return () => {
      this.listeners.delete(listener)
    }
  }

  resolveFromSettings(
    settings: AppSettings,
    mode: SessionMode,
    credentials?: ResolverCredentials
  ): ResolvedRuntimeConfig {
    const platform = this.options.platformProvider?.()

    return resolveRuntimeConfig({
      settings,
      mode,
      ...(credentials ? { credentials } : {}),
      ...(platform ? { platform } : {})
    })
  }

  async resolveRuntimeConfig(
    mode: SessionMode,
    credentials?: ResolverCredentials
  ): Promise<ResolvedRuntimeConfig> {
    const settings = await this.getSettings()
    return this.resolveFromSettings(settings, mode, credentials)
  }

  async resolveProfileRuntimeConfig(
    profileId: string,
    mode: SessionMode,
    credentials?: ResolverCredentials
  ): Promise<ResolvedRuntimeConfig> {
    const settings = await this.getSettings()

    return this.resolveFromSettings(
      {
        ...settings,
        speech: {
          ...settings.speech,
          selectedProfileId: profileId
        }
      },
      mode,
      credentials
    )
  }

  private emitChanged(settings: AppSettings): void {
    for (const listener of this.listeners) {
      listener(settings)
    }
  }
}

function normalizeExposedSettings(settings: AppSettings): AppSettings {
  if (getExposedProfileById(settings.speech.selectedProfileId)) {
    return settings
  }

  return {
    ...settings,
    speech: {
      ...settings.speech,
      selectedProfileId: createDefaultSettings().speech.selectedProfileId
    }
  }
}
