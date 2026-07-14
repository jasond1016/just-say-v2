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
  onDeploymentSignatureChange?: () => void | Promise<void>
}

export class RuntimeSettingsContext {
  private cachedSettings: AppSettings
  private cachedStoredCredentials: StoredCredentials
  private cachedRuntimeConfigs: Partial<Record<SessionMode, ResolvedRuntimeConfig>> = {}
  private cachedRuntimeConfigErrors: Partial<Record<SessionMode, Error>> = {}
  private readonly settingsListeners = new Set<(settings: AppSettings) => void>()

  private constructor(
    private readonly settingsService: SettingsService,
    private readonly credentialsRepository: CredentialsRepository,
    private readonly onDeploymentSignatureChange?: () => void | Promise<void>,
    initial: {
      settings: AppSettings
      storedCredentials: StoredCredentials
    }
  ) {
    this.cachedSettings = initial.settings
    this.cachedStoredCredentials = initial.storedCredentials
  }

  static async create(options: RuntimeSettingsContextOptions): Promise<RuntimeSettingsContext> {
    const context = new RuntimeSettingsContext(
      options.settingsService,
      options.credentialsRepository,
      options.onDeploymentSignatureChange,
      {
        settings: await options.settingsService.getSettings(),
        storedCredentials: (await options.credentialsRepository.get()) ?? {}
      }
    )

    await context.refreshCache()
    options.settingsService.onChanged(() => {
      void context.handleExternalSettingsChanged()
    })
    return context
  }

  getCachedSettings(): AppSettings {
    return this.cachedSettings
  }

  createSettingsProvider(): SettingsProvider {
    return {
      getSettings: () => this.cachedSettings,
      resolveRuntimeConfig: (mode) => this.resolveCachedRuntimeConfig(mode)
    }
  }

  async getSettings(): Promise<AppSettings> {
    return this.settingsService.getSettings()
  }

  async updateSettings(patch: SettingsPatch): Promise<AppSettings> {
    const previousDeploymentSignature = getLocalServiceSettingsSignature(this.cachedSettings)
    const updated = await this.settingsService.updateSettings(patch)
    await this.refreshCache()

    if (getLocalServiceSettingsSignature(this.cachedSettings) !== previousDeploymentSignature) {
      await this.onDeploymentSignatureChange?.()
    }

    return updated
  }

  async saveTranslationCredentials(input: TranslationCredentialsInput): Promise<AppSettings> {
    await this.credentialsRepository.save({
      ...this.cachedStoredCredentials,
      translationApiKey: input.apiKey
    })
    this.cachedStoredCredentials = (await this.credentialsRepository.get()) ?? {}
    await this.refreshCache()
    const settings = await this.settingsService.getSettings()
    this.notifySettingsChanged(settings)
    return settings
  }

  onChanged(listener: (settings: AppSettings) => void): () => void {
    this.settingsListeners.add(listener)

    return () => {
      this.settingsListeners.delete(listener)
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
    await this.refreshCache()
    this.notifySettingsChanged(this.cachedSettings)
  }

  private async refreshCache(): Promise<void> {
    this.cachedStoredCredentials = (await this.credentialsRepository.get()) ?? {}
    const credentials = this.getRuntimeCredentials()
    const settings = await this.settingsService.getSettings()
    // Use context credentials so bootstrap works before create-runtime rebinds credentialsProvider.
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
        nextRuntimeConfigs[mode] = await this.settingsService.resolveRuntimeConfig(mode, credentials)
      } catch (errorLike) {
        nextRuntimeConfigErrors[mode] =
          errorLike instanceof Error ? errorLike : new Error(`Could not resolve ${mode} runtime config`)
      }
    }

    this.cachedRuntimeConfigs = nextRuntimeConfigs
    this.cachedRuntimeConfigErrors = nextRuntimeConfigErrors
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
