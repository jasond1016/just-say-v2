import type { RecognitionEngine } from '../../core/contracts/engine'
import type {
  AppErrorPayload,
  EngineProfile,
  LocalServiceStatus,
  ProfileTestResult,
  ResolvedRuntimeConfig
} from '../../shared/api-types'
import type { SessionMode } from '../../shared/primitive-types'
import { createRecognitionEngine } from '../engines/create-recognition-engine'
import type { SpeechHandlerService } from '../ipc/speech-handlers'
import type { EngineFactory } from './engine-registry'
import { EngineRegistry } from './engine-registry'
import type { LocalServiceController } from './local-service-supervisor'
import { LocalServiceSupervisor } from './local-service-supervisor'
import {
  createIdentityMismatchAppError,
  establishRuntimeReadiness
} from './runtime-readiness'

export interface RuntimeConfigResolver {
  resolveRuntimeConfig(mode: SessionMode): Promise<ResolvedRuntimeConfig>
  resolveProfileRuntimeConfig(profileId: string, mode: SessionMode): Promise<ResolvedRuntimeConfig>
}

export type CreateSpeechRuntimeInput = {
  profiles: readonly EngineProfile[]
  localServiceController: LocalServiceController
  runtimeConfigResolver: RuntimeConfigResolver
  engineFactory?: EngineFactory
  supervisor?: LocalServiceSupervisor
}

export class SpeechRuntime implements SpeechHandlerService {
  private constructor(
    private readonly registry: EngineRegistry,
    private readonly localServiceSupervisor: LocalServiceSupervisor,
    private readonly runtimeConfigResolver: RuntimeConfigResolver
  ) {}

  static create(input: CreateSpeechRuntimeInput): SpeechRuntime {
    const supervisor = input.supervisor ?? new LocalServiceSupervisor(input.localServiceController)
    const engineFactory =
      input.engineFactory ??
      ((config) =>
        createRecognitionEngine(config, {
          establishReadiness: (warmupInput) => {
            const target = config.engineConfig.localService

            if (!target) {
              throw new Error(`Profile "${config.engineProfile.id}" is missing local service configuration`)
            }

            return establishRuntimeReadiness(
              { supervisor },
              {
                target,
                runtimeFamilyId: config.engineProfile.runtimeFamilyId,
                expectedIdentity: {
                  runtimeFamilyId: config.engineProfile.runtimeFamilyId,
                  modelIdentifier: config.engineProfile.modelIdentifier
                },
                mode: warmupInput.mode,
                language: warmupInput.language,
                intent: 'session-start'
              }
            )
          }
        }))
    const registry = new EngineRegistry(input.profiles, engineFactory)

    return new SpeechRuntime(registry, supervisor, input.runtimeConfigResolver)
  }

  createEngine(config: ResolvedRuntimeConfig): RecognitionEngine {
    return this.registry.createForRuntimeConfig(config)
  }

  getStatus(): LocalServiceStatus {
    return this.localServiceSupervisor.getStatus()
  }

  onStatusChange(listener: (status: LocalServiceStatus) => void): () => void {
    return this.localServiceSupervisor.onStatusChange(listener)
  }

  async stop(): Promise<void> {
    await this.localServiceSupervisor.stop()
  }

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

        const expectedIdentity = {
          runtimeFamilyId: profile.runtimeFamilyId,
          modelIdentifier: profile.modelIdentifier
        }
        const readiness = await establishRuntimeReadiness(
          { supervisor: this.localServiceSupervisor },
          {
            target,
            runtimeFamilyId: profile.runtimeFamilyId,
            expectedIdentity,
            mode: 'meeting',
            language: String(runtimeConfig.engineConfig.language),
            intent: 'profile-check'
          }
        )

        if (readiness.identityMismatch) {
          return {
            ok: false,
            profileId,
            localService: this.localServiceSupervisor.getStatus(),
            error: createIdentityMismatchAppError(expectedIdentity, readiness.health)
          }
        }

        const { health, prewarmTriggered } = readiness
        const engine = this.createEngine(runtimeConfig)
        const capabilities = await engine.getCapabilities()

        return {
          ok: true,
          profileId,
          runtimeIdentity: {
            runtimeFamilyId: health.runtimeFamilyId,
            modelIdentifier: health.modelIdentifier
          },
          runtimeReadiness: health.readiness,
          prewarmTriggered,
          capabilities,
          localService: this.localServiceSupervisor.getStatus()
        }
      }

      const engine = this.createEngine(runtimeConfig)
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
