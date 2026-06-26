import { describe, expect, it, vi } from 'vitest'

import { exposedProfileCatalog, profileCatalog } from '../../core/settings/profile-catalog'
import type { RecognitionEngine } from '../../core/contracts/engine'
import type { ResolvedRuntimeConfig, RuntimeReadiness } from '../../shared/api-types'
import type { LocalServiceController } from './local-service-supervisor'
import { LocalServiceSupervisor } from './local-service-supervisor'
import { SpeechRuntime } from './speech-runtime'

describe('SpeechRuntime', () => {
  it('lists profiles from the registry', async () => {
    const runtime = createSpeechRuntime()

    await expect(runtime.listProfiles()).resolves.toEqual(
      expect.arrayContaining(exposedProfileCatalog.map((profile) => expect.objectContaining({ id: profile.id })))
    )
    await expect(runtime.listProfiles()).resolves.toHaveLength(exposedProfileCatalog.length)
    await expect(runtime.listProfiles()).resolves.not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'cloud-low-cost' })])
    )
  })

  it('creates engines through the internal registry', () => {
    const runtime = createSpeechRuntime()
    const config = createResolvedRuntimeConfig('local-fast')

    expect(runtime.createEngine(config)).toBeInstanceOf(FakeRecognitionEngine)
  })

  it('tests a local profile and reports capabilities plus local service status', async () => {
    const runtime = createSpeechRuntime()

    await expect(runtime.testProfile('local-fast')).resolves.toMatchObject({
      ok: true,
      profileId: 'local-fast',
      localService: 'healthy',
      capabilities: {
        streaming: true
      }
    })
  })

  it('returns quickly when qwen is already warming in the background', async () => {
    const prewarm = vi.fn(async (target) => ({
      ok: true,
      runtimeFamilyId: target.runtimeFamilyId,
      modelIdentifier: target.modelIdentifier,
      readiness: 'ready' as const
    }))
    const runtime = createSpeechRuntime({
      controller: createLocalServiceController({
        healthReadiness: 'warming',
        prewarm
      })
    })

    await expect(runtime.testProfile('local-accurate')).resolves.toMatchObject({
      ok: true,
      profileId: 'local-accurate',
      runtimeReadiness: 'warming',
      prewarmTriggered: false,
      localService: 'degraded'
    })

    expect(prewarm).not.toHaveBeenCalled()
  })

  it('triggers qwen prewarm when the service is reachable but still cold', async () => {
    const prewarm = vi.fn(async (target) => ({
      ok: true,
      runtimeFamilyId: target.runtimeFamilyId,
      modelIdentifier: target.modelIdentifier,
      readiness: 'ready' as const
    }))
    const runtime = createSpeechRuntime({
      controller: createLocalServiceController({
        healthReadiness: 'prewarm-required',
        prewarm
      })
    })

    await expect(runtime.testProfile('local-accurate')).resolves.toMatchObject({
      ok: true,
      profileId: 'local-accurate',
      runtimeReadiness: 'ready',
      prewarmTriggered: true,
      localService: 'healthy'
    })

    expect(prewarm).toHaveBeenCalledTimes(1)
  })

  it('returns a structured error for an unknown profile', async () => {
    const runtime = createSpeechRuntime()

    await expect(runtime.testProfile('missing')).resolves.toMatchObject({
      ok: false,
      profileId: 'missing',
      error: {
        code: 'E_INVALID_SETTINGS'
      }
    })
  })

  it('restarts the local service through the supervisor', async () => {
    const restart = vi.fn(async () => 'healthy' as const)
    const runtime = createSpeechRuntime({
      restart
    })

    await runtime.restartLocalService()

    expect(restart).toHaveBeenCalled()
  })

  it('probes the local service through the supervisor without starting it', async () => {
    const probe = vi.fn(async () => 'healthy' as const)
    const runtime = createSpeechRuntime({
      probe
    })

    await expect(runtime.probeLocalService()).resolves.toBe('healthy')

    expect(probe).toHaveBeenCalled()
  })
})

function createSpeechRuntime(overrides: {
  restart?: () => Promise<'healthy' | 'degraded' | 'starting' | 'stopped' | 'failed'>
  probe?: () => Promise<'healthy' | 'degraded' | 'starting' | 'stopped' | 'failed'>
  controller?: LocalServiceController
} = {}): SpeechRuntime {
  const controller = overrides.controller ?? createLocalServiceController()
  const supervisor = new LocalServiceSupervisor(controller)
  if (overrides.restart) {
    supervisor.restart = overrides.restart as LocalServiceSupervisor['restart']
  }
  if (overrides.probe) {
    supervisor.probe = overrides.probe as LocalServiceSupervisor['probe']
  }

  return SpeechRuntime.create({
    profiles: profileCatalog,
    localServiceController: controller,
    supervisor,
    engineFactory: (config) => new FakeRecognitionEngine(config),
    runtimeConfigResolver: {
      async resolveRuntimeConfig() {
        return createResolvedRuntimeConfig('local-fast')
      },
      async resolveProfileRuntimeConfig(profileId) {
        return createResolvedRuntimeConfig(profileId)
      }
    }
  })
}

function createResolvedRuntimeConfig(profileId: string): ResolvedRuntimeConfig {
  const profile = profileCatalog.find((item) => item.id === profileId)

  if (!profile) {
    throw new Error(`Unknown engine profile: ${profileId}`)
  }

  return {
    engineProfile: profile,
    engineConfig: {
      mode: 'meeting',
      profileId: profile.id,
      preset: profile.preset,
      language: 'auto',
      diagnosticsEnabled: true,
      experimentalFlags: [],
      ...(profile.capabilities.requiresLocalService
        ? {
            localService: {
              mode: 'managed-local',
              host: '127.0.0.1',
              port: 8765,
              runtimeFamilyId: profile.runtimeFamilyId,
              modelIdentifier: profile.modelIdentifier
            }
          }
        : {})
    },
    captureConfig: {
      sampleRate: 16000,
      chunkMs: 100
    },
    outputConfig: {
      method: 'simulate_input'
    }
  }
}

function createLocalServiceController(overrides: {
  healthReadiness?: RuntimeReadiness
  prewarm?: LocalServiceController['prewarm']
} = {}): LocalServiceController {
  return {
    async start() {},
    async stop() {},
    async healthCheck(target) {
      return {
        ok: true,
        runtimeFamilyId: target.runtimeFamilyId,
        modelIdentifier: target.modelIdentifier,
        readiness: overrides.healthReadiness ?? 'ready'
      }
    },
    async prewarm(target, input) {
      if (overrides.prewarm) {
        return overrides.prewarm(target, input)
      }

      return {
        ok: true,
        runtimeFamilyId: target.runtimeFamilyId,
        modelIdentifier: target.modelIdentifier,
        readiness: 'ready'
      }
    }
  }
}

class FakeRecognitionEngine implements RecognitionEngine {
  constructor(private readonly config: ResolvedRuntimeConfig) {}

  async getCapabilities() {
    return {
      ...this.config.engineProfile.capabilities
    }
  }

  async warmup(): Promise<void> {}

  async startSession(): Promise<void> {}

  pushAudio(): void {}

  async stopSession(): Promise<void> {}

  async abortSession(): Promise<void> {}

  onEvent(): () => void {
    return () => {}
  }
}
