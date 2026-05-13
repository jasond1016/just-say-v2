import type {
  AppErrorCode,
  AppErrorPayload,
  AppSettings,
  EngineProfile,
  ResolvedRuntimeConfig,
  TranslationRuntimeConfig
} from '../../shared/api-types'
import type { SessionMode } from '../../shared/primitive-types'
import { getProfileById, profileCatalog } from './profile-catalog'
import { normalizeSettings } from './settings-schema'

export type ResolverCredentials = {
  cloudApiKey?: string
  translationApiKey?: string
}

export type PlatformCapabilities = {
  hasNetwork: boolean
  localServiceAvailable: boolean
}

export type ResolveRuntimeConfigInput = {
  settings: AppSettings
  mode: SessionMode
  credentials?: ResolverCredentials
  platform?: Partial<PlatformCapabilities>
  profiles?: readonly EngineProfile[]
}

export class SettingsResolverError extends Error {
  constructor(readonly payload: AppErrorPayload) {
    super(payload.message)
    this.name = 'SettingsResolverError'
  }
}

const DEFAULT_PLATFORM_CAPABILITIES: PlatformCapabilities = {
  hasNetwork: true,
  localServiceAvailable: true
}

const DEFAULT_CAPTURE_CONFIG: ResolvedRuntimeConfig['captureConfig'] = {
  sampleRate: 16000,
  chunkMs: 100
}

const DEFAULT_LOCAL_SERVICE_HOST = '127.0.0.1'
const DEFAULT_LOCAL_SERVICE_PORT = 8765

export function resolveRuntimeConfig(input: ResolveRuntimeConfigInput): ResolvedRuntimeConfig {
  const settings = normalizeSettings(input.settings)
  const platform = {
    ...DEFAULT_PLATFORM_CAPABILITIES,
    ...input.platform
  }
  const engineProfile = resolveEngineProfile(settings, input.profiles ?? profileCatalog)

  assertPlatformCompatibility(engineProfile, platform)
  assertCredentialAvailability(engineProfile, settings, input.mode, input.credentials)

  const translationEnabled =
    input.mode === 'ptt' ? settings.translation.enabledForPtt : settings.translation.enabledForMeeting

  return {
    engineProfile,
    engineConfig: {
      mode: input.mode,
      profileId: engineProfile.id,
      preset: engineProfile.preset,
      language: settings.speech.language,
      diagnosticsEnabled: settings.advanced.diagnosticsEnabled,
      experimentalFlags: [...settings.advanced.experimentalFlags],
      ...(engineProfile.capabilities.requiresLocalService
        ? { localService: resolveLocalServiceConfig(settings) }
        : {}),
      ...(engineProfile.capabilities.requiresNetwork && input.credentials?.cloudApiKey
        ? {
            credentials: {
              cloudApiKey: input.credentials.cloudApiKey
            }
          }
        : {})
    },
    ...(translationEnabled
      ? {
          translationConfig: {
            provider: settings.translation.provider,
            targetLanguage: settings.translation.targetLanguage,
            sourceLanguage: settings.speech.language,
            ...(settings.translation.endpoint ? { endpoint: settings.translation.endpoint } : {}),
            ...(settings.translation.model ? { model: settings.translation.model } : {}),
            credentials: {
              translationApiKey: input.credentials!.translationApiKey!
            }
          } satisfies TranslationRuntimeConfig
        }
      : {}),
    captureConfig: DEFAULT_CAPTURE_CONFIG,
    outputConfig: {
      method: settings.output.method
    }
  }
}

function resolveLocalServiceConfig(settings: AppSettings) {
  if (settings.advanced.localServiceMode === 'remote-service') {
    const host = settings.advanced.remoteServiceHost?.trim()

    if (!host) {
      throw createSettingsResolverError(
        'E_INVALID_SETTINGS',
        'Remote speech service host is required when remote service mode is enabled',
        false,
        {
          localServiceMode: settings.advanced.localServiceMode,
          missingField: 'advanced.remoteServiceHost'
        }
      )
    }

    return {
      mode: settings.advanced.localServiceMode,
      host,
      port: settings.advanced.remoteServicePort ?? DEFAULT_LOCAL_SERVICE_PORT
    }
  }

  return {
    mode: settings.advanced.localServiceMode,
    host: settings.advanced.localServiceHost ?? DEFAULT_LOCAL_SERVICE_HOST,
    port: settings.advanced.localServicePort ?? DEFAULT_LOCAL_SERVICE_PORT
  }
}

export function resolveEngineProfile(
  settings: Pick<AppSettings, 'speech'>,
  profiles: readonly EngineProfile[] = profileCatalog
): EngineProfile {
  const profile = profiles.find((candidate) => candidate.id === settings.speech.selectedProfileId)

  if (!profile) {
    throw createSettingsResolverError(
      'E_INVALID_SETTINGS',
      `Unknown engine profile: ${settings.speech.selectedProfileId}`,
      true,
      {
        selectedProfileId: settings.speech.selectedProfileId,
        availableProfileIds: profiles.map((candidate) => candidate.id)
      }
    )
  }

  return profile
}

function assertPlatformCompatibility(
  profile: EngineProfile,
  platform: PlatformCapabilities
): void {
  if (profile.capabilities.requiresNetwork && !platform.hasNetwork) {
    throw createSettingsResolverError(
      'E_ENGINE_UNAVAILABLE',
      `Profile "${profile.id}" requires network access`,
      true,
      { profileId: profile.id, requirement: 'network' }
    )
  }

  if (profile.capabilities.requiresLocalService && !platform.localServiceAvailable) {
    throw createSettingsResolverError(
      'E_ENGINE_UNAVAILABLE',
      `Profile "${profile.id}" requires the local service`,
      true,
      { profileId: profile.id, requirement: 'local-service' }
    )
  }
}

function assertCredentialAvailability(
  profile: EngineProfile,
  settings: AppSettings,
  mode: SessionMode,
  credentials: ResolverCredentials | undefined
): void {
  if (profile.kind === 'cloud' && !credentials?.cloudApiKey) {
    throw createSettingsResolverError(
      'E_INVALID_SETTINGS',
      `Profile "${profile.id}" is missing cloud credentials`,
      true,
      { profileId: profile.id, missingCredential: 'cloudApiKey' }
    )
  }

  const translationEnabled =
    mode === 'ptt' ? settings.translation.enabledForPtt : settings.translation.enabledForMeeting

  if (!translationEnabled) {
    return
  }

  if (!credentials?.translationApiKey) {
    throw createSettingsResolverError(
      'E_INVALID_SETTINGS',
      'Translation is enabled but translation credentials are missing',
      true,
      { mode, provider: settings.translation.provider, missingCredential: 'translationApiKey' }
    )
  }
}

function createSettingsResolverError(
  code: AppErrorCode,
  message: string,
  retryable: boolean,
  detail?: Record<string, unknown>
): SettingsResolverError {
  return new SettingsResolverError({
    code,
    message,
    retryable,
    ...(detail !== undefined ? { detail } : {})
  })
}
