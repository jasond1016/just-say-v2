import type { AppErrorPayload, EngineProfile, ProfileTestResult, ResolvedRuntimeConfig } from '../../shared/api-types'
import type { SessionMode } from '../../shared/primitive-types'
import type { EngineRegistry } from './engine-registry'
import type { LocalServiceSupervisor } from './local-service-supervisor'

export interface RuntimeConfigResolver {
  resolveRuntimeConfig(mode: SessionMode): Promise<ResolvedRuntimeConfig>
  resolveProfileRuntimeConfig(profileId: string, mode: SessionMode): Promise<ResolvedRuntimeConfig>
}

export class SpeechService {
  constructor(
    private readonly registry: EngineRegistry,
    private readonly localServiceSupervisor: LocalServiceSupervisor,
    private readonly runtimeConfigResolver: RuntimeConfigResolver
  ) {}

  async listProfiles(): Promise<EngineProfile[]> {
    return this.registry.getProfileCatalog().filter((profile) => profile.kind === 'local')
  }

  async probeLocalService(): Promise<'healthy' | 'degraded' | 'starting' | 'stopped' | 'failed'> {
    try {
      const runtimeConfig = await this.runtimeConfigResolver.resolveRuntimeConfig('meeting')
      const target = runtimeConfig.engineConfig.localService

      if (!target) {
        return 'stopped'
      }

      return this.localServiceSupervisor.probe(target)
    } catch (errorLike) {
      return this.localServiceSupervisor.setFailure(normalizeSpeechError(errorLike))
    }
  }

  async restartLocalService(): Promise<void> {
    const runtimeConfig = await this.runtimeConfigResolver.resolveRuntimeConfig('meeting')
    const target = runtimeConfig.engineConfig.localService

    if (!target) {
      await this.localServiceSupervisor.stop()
      return
    }

    await this.localServiceSupervisor.restart(target)
  }

  async testProfile(profileId: string): Promise<ProfileTestResult> {
    const profile = this.registry.getProfileById(profileId)

    if (!profile) {
      return {
        ok: false,
        profileId,
        error: {
          code: 'E_INVALID_SETTINGS',
          message: `Unknown engine profile: ${profileId}`,
          retryable: false
        }
      }
    }

    try {
      const runtimeConfig = await this.runtimeConfigResolver.resolveProfileRuntimeConfig(profileId, 'meeting')

      if (profile.capabilities.requiresLocalService) {
        const target = runtimeConfig.engineConfig.localService

        if (!target) {
          throw new Error(`Profile "${profileId}" is missing local service configuration`)
        }

        const health = await this.localServiceSupervisor.prewarm(target, {
          mode: 'meeting',
          language: String(runtimeConfig.engineConfig.language)
        })
        const engine = this.registry.createForRuntimeConfig(runtimeConfig)
        const capabilities = await engine.getCapabilities()

        return {
          ok: true,
          profileId,
          runtimeIdentity: {
            runtimeFamilyId: health.runtimeFamilyId,
            modelIdentifier: health.modelIdentifier
          },
          runtimeReadiness: health.readiness,
          prewarmTriggered: profile.runtimeFamilyId === 'qwen3-asr',
          capabilities,
          localService: this.localServiceSupervisor.getStatus()
        }
      }

      const engine = this.registry.createForRuntimeConfig(runtimeConfig)
      const capabilities = await engine.getCapabilities()

      return {
        ok: true,
        profileId,
        runtimeIdentity: {
          runtimeFamilyId: runtimeConfig.engineProfile.runtimeFamilyId,
          modelIdentifier: runtimeConfig.engineProfile.modelIdentifier
        },
        runtimeReadiness: 'ready',
        capabilities,
        ...(profile.capabilities.requiresLocalService
          ? {
              localService: this.localServiceSupervisor.getStatus()
            }
          : {})
      }
    } catch (errorLike) {
      return {
        ok: false,
        profileId,
        ...(profile.capabilities.requiresLocalService
          ? {
              localService: this.localServiceSupervisor.getStatus()
            }
          : {}),
        error: normalizeSpeechError(errorLike)
      }
    }
  }
}

function normalizeSpeechError(errorLike: unknown): AppErrorPayload {
  if (isAppErrorPayload(errorLike)) {
    return errorLike
  }

  if (errorLike instanceof Error) {
    return {
      code: 'E_ENGINE_UNAVAILABLE',
      message: errorLike.message,
      retryable: true
    }
  }

  return {
    code: 'E_ENGINE_UNAVAILABLE',
    message: 'Unknown speech engine error',
    retryable: true
  }
}

function isAppErrorPayload(value: unknown): value is AppErrorPayload {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Partial<AppErrorPayload>
  return (
    typeof candidate.code === 'string' &&
    typeof candidate.message === 'string' &&
    typeof candidate.retryable === 'boolean'
  )
}
