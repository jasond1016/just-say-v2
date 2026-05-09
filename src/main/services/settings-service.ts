import type { AppSettings, ResolvedRuntimeConfig, SettingsPatch } from '../../shared/api-types'
import type { SessionMode } from '../../shared/primitive-types'
import type { SettingsRepository } from '../persistence/settings-repository'
import {
  applySettingsPatch,
  createDefaultSettings,
  normalizeSettings
} from '../../core/settings/settings-schema'
import {
  resolveRuntimeConfig,
  type PlatformCapabilities,
  type ResolverCredentials
} from '../../core/settings/settings-resolver'

export type SettingsServiceOptions = {
  credentialsProvider?: () => ResolverCredentials | undefined
  platformProvider?: () => Partial<PlatformCapabilities> | undefined
}

export class SettingsService {
  constructor(
    private readonly repository: SettingsRepository,
    private readonly options: SettingsServiceOptions = {}
  ) {}

  async getSettings(): Promise<AppSettings> {
    const stored = await this.repository.get()
    return stored ? normalizeSettings(stored) : createDefaultSettings()
  }

  async updateSettings(patch: SettingsPatch): Promise<AppSettings> {
    const current = await this.getSettings()
    const next = applySettingsPatch(current, patch)
    await this.repository.save(next)
    return next
  }

  async resolveRuntimeConfig(mode: SessionMode): Promise<ResolvedRuntimeConfig> {
    const settings = await this.getSettings()
    return this.resolveRuntimeConfigForSettings(settings, mode)
  }

  async resolveProfileRuntimeConfig(
    profileId: string,
    mode: SessionMode
  ): Promise<ResolvedRuntimeConfig> {
    const settings = await this.getSettings()

    return this.resolveRuntimeConfigForSettings(
      {
        ...settings,
        speech: {
          ...settings.speech,
          selectedProfileId: profileId
        }
      },
      mode
    )
  }

  private resolveRuntimeConfigForSettings(
    settings: AppSettings,
    mode: SessionMode
  ): ResolvedRuntimeConfig {
    const credentials = this.options.credentialsProvider?.()
    const platform = this.options.platformProvider?.()

    return resolveRuntimeConfig({
      settings,
      mode,
      ...(credentials ? { credentials } : {}),
      ...(platform ? { platform } : {})
    })
  }
}
