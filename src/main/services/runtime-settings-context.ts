import { getProfileById } from '../../core/settings/profile-catalog'
import type { ResolverCredentials } from '../../core/settings/settings-resolver'
import type {
  AppSettings,
  ResolvedRuntimeConfig,
  SettingsPatch,
  TranscriptNotesRuntimeConfig,
  TranslationCredentialsInput
} from '../../shared/api-types'
import type { SessionMode } from '../../shared/primitive-types'
import type { StoredCredentials } from '../persistence/credentials-repository'
import { getEnvironmentCredentials } from './environment-credentials-provider'
import type { SettingsService } from './settings-service'
import type { RuntimeConfigResolver } from './speech-runtime'

export type SettingsProvider = {
  getSettings(): AppSettings
  resolveRuntimeConfig(mode: SessionMode): ResolvedRuntimeConfig
}

export type CredentialsRepository = {
  get(): Promise<StoredCredentials | undefined>
  save(credentials: StoredCredentials): Promise<void>
}

export type RuntimeSettingsContextOptions = {
  settingsService: SettingsService
  credentialsRepository: CredentialsRepository
}

export class RuntimeSettingsContext {
  private cachedSettings: AppSettings
  private cachedStoredCredentials: StoredCredentials
  private cachedRuntimeConfigs: Partial<Record<SessionMode, ResolvedRuntimeConfig>> = {}
  private cachedRuntimeConfigErrors: Partial<Record<SessionMode, Error>> = {}
  private readonly settingsListeners = new Set<(settings: AppSettings) => void>()
  private readonly deploymentSignatureListeners = new Set<() => void | Promise<void>>()
  private ignoreExternalSettingsChanged = false

  private constructor(
    private readonly settingsService: SettingsService,
    private readonly credentialsRepository: CredentialsRepository,
    initial: {
      settings: AppSettings
      storedCredentials: StoredCredentials
    }
  ) {
    this.cachedSettings = initial.settings
    this.cachedStoredCredentials = initial.storedCredentials
  }

  static async create(options: RuntimeSettingsContextOptions): Promise<RuntimeSettingsContext> {
    const context = new RuntimeSettingsContext(options.settingsService, options.credentialsRepository, {
      settings: await options.settingsService.getSettings(),
      storedCredentials: (await options.credentialsRepository.get()) ?? {}
    })

    await context.refreshCache()
    options.settingsService.onChanged(() => {
      void context.handleExternalSettingsChanged()
    })
    return context
  }

  getCachedSettings(): AppSettings {
    return this.cachedSettings
  }

  /** Projected Runtime Settings — same view as getCachedSettings. */
  getSettings(): AppSettings {
    return this.cachedSettings
  }

  createSettingsProvider(): SettingsProvider {
    return {
      getSettings: () => this.cachedSettings,
      resolveRuntimeConfig: (mode) => this.resolveCachedRuntimeConfig(mode)
    }
  }

  createRuntimeConfigResolver(): RuntimeConfigResolver {
    return {
      resolveRuntimeConfig: async (mode) => this.resolveCachedRuntimeConfig(mode),
      resolveProfileRuntimeConfig: async (profileId, mode) =>
        this.resolveProfileFromCache(profileId, mode)
    }
  }

  async updateSettings(patch: SettingsPatch): Promise<AppSettings> {
    const previousDeploymentSignature = getLocalServiceSettingsSignature(this.cachedSettings)
    this.ignoreExternalSettingsChanged = true
    try {
      await this.settingsService.updateSettings(patch)
    } finally {
      this.ignoreExternalSettingsChanged = false
    }
    await this.refreshCache()
    this.notifySettingsChanged(this.cachedSettings)

    if (getLocalServiceSettingsSignature(this.cachedSettings) !== previousDeploymentSignature) {
      await this.notifyDeploymentSignatureChanged()
    }

    return this.cachedSettings
  }

  async saveTranslationCredentials(input: TranslationCredentialsInput): Promise<AppSettings> {
    await this.credentialsRepository.save({
      ...this.cachedStoredCredentials,
      translationApiKey: input.apiKey
    })
    this.cachedStoredCredentials = (await this.credentialsRepository.get()) ?? {}
    await this.refreshCache()
    this.notifySettingsChanged(this.cachedSettings)
    return this.cachedSettings
  }

  onChanged(listener: (settings: AppSettings) => void): () => void {
    this.settingsListeners.add(listener)

    return () => {
      this.settingsListeners.delete(listener)
    }
  }

  onDeploymentSignatureChange(listener: () => void | Promise<void>): () => void {
    this.deploymentSignatureListeners.add(listener)

    return () => {
      this.deploymentSignatureListeners.delete(listener)
    }
  }

  getRuntimeCredentials(): ResolverCredentials | undefined {
    const environmentCredentials = getEnvironmentCredentials()
    const merged: ResolverCredentials = {
      ...(environmentCredentials ?? {}),
      ...this.cachedStoredCredentials
    }

    return merged.cloudApiKey || merged.translationApiKey ? merged : undefined
  }

  resolveTranscriptNotesRuntimeConfig(): TranscriptNotesRuntimeConfig {
    return resolveTranscriptNotesRuntimeConfig(this.cachedSettings, this.getRuntimeCredentials())
  }

  shouldProbeSelectedLocalService(): boolean {
    const selectedProfile = getProfileById(this.cachedSettings.speech.selectedProfileId)
    return Boolean(selectedProfile?.capabilities.requiresLocalService)
  }

  private async handleExternalSettingsChanged(): Promise<void> {
    if (this.ignoreExternalSettingsChanged) {
      return
    }

    const previousDeploymentSignature = getLocalServiceSettingsSignature(this.cachedSettings)
    await this.refreshCache()
    this.notifySettingsChanged(this.cachedSettings)

    if (getLocalServiceSettingsSignature(this.cachedSettings) !== previousDeploymentSignature) {
      await this.notifyDeploymentSignatureChanged()
    }
  }

  private async refreshCache(): Promise<void> {
    this.cachedStoredCredentials = (await this.credentialsRepository.get()) ?? {}
    const credentials = this.getRuntimeCredentials()
    const settings = await this.settingsService.getSettings()
    this.cachedSettings = {
      ...settings,
      translation: {
        ...settings.translation,
        apiKeyConfigured: Boolean(credentials?.translationApiKey)
      }
    }

    const nextRuntimeConfigs: Partial<Record<SessionMode, ResolvedRuntimeConfig>> = {}
    const nextRuntimeConfigErrors: Partial<Record<SessionMode, Error>> = {}

    for (const mode of ['ptt', 'meeting'] as const) {
      try {
        nextRuntimeConfigs[mode] = this.settingsService.resolveFromSettings(settings, mode, credentials)
      } catch (errorLike) {
        nextRuntimeConfigErrors[mode] =
          errorLike instanceof Error ? errorLike : new Error(`Could not resolve ${mode} runtime config`)
      }
    }

    this.cachedRuntimeConfigs = nextRuntimeConfigs
    this.cachedRuntimeConfigErrors = nextRuntimeConfigErrors
  }

  private resolveProfileFromCache(profileId: string, mode: SessionMode): ResolvedRuntimeConfig {
    const credentials = this.getRuntimeCredentials()
    const settings: AppSettings = {
      ...this.cachedSettings,
      speech: {
        ...this.cachedSettings.speech,
        selectedProfileId: profileId
      }
    }

    return this.settingsService.resolveFromSettings(settings, mode, credentials)
  }

  private resolveCachedRuntimeConfig(mode: SessionMode): ResolvedRuntimeConfig {
    const error = this.cachedRuntimeConfigErrors[mode]

    if (error) {
      throw error
    }

    const runtimeConfig = this.cachedRuntimeConfigs[mode]

    if (!runtimeConfig) {
      throw new Error(`Runtime config for ${mode} is unavailable`)
    }

    return runtimeConfig
  }

  private notifySettingsChanged(settings: AppSettings): void {
    for (const listener of this.settingsListeners) {
      listener(settings)
    }
  }

  private async notifyDeploymentSignatureChanged(): Promise<void> {
    for (const listener of this.deploymentSignatureListeners) {
      await listener()
    }
  }
}

export function getLocalServiceSettingsSignature(settings: AppSettings): string {
  return JSON.stringify({
    profileId: settings.speech.selectedProfileId,
    mode: settings.advanced.localServiceMode,
    localHost: settings.advanced.localServiceHost ?? null,
    localPort: settings.advanced.localServicePort ?? null,
    remoteHost: settings.advanced.remoteServiceHost ?? null,
    remotePort: settings.advanced.remoteServicePort ?? null
  })
}

function resolveTranscriptNotesRuntimeConfig(
  settings: AppSettings,
  credentials: ResolverCredentials | undefined
): TranscriptNotesRuntimeConfig {
  const translationApiKey = credentials?.translationApiKey?.trim()

  if (!translationApiKey) {
    throw new Error('Translation API key is required before generating notes')
  }

  const envEndpoint = process.env.JUSTSAY_TRANSLATION_BASE_URL?.trim()
  const envModel = process.env.JUSTSAY_TRANSLATION_MODEL?.trim()

  return {
    provider: settings.translation.provider,
    language: settings.translation.targetLanguage,
    ...(settings.translation.endpoint?.trim()
      ? { endpoint: settings.translation.endpoint.trim() }
      : envEndpoint
        ? { endpoint: envEndpoint }
        : {}),
    ...(settings.translation.model?.trim()
      ? { model: settings.translation.model.trim() }
      : envModel
        ? { model: envModel }
        : {}),
    credentials: {
      translationApiKey
    }
  }
}
