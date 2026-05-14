import { describe, expect, it, vi } from 'vitest'

import { exposedProfileCatalog, profileCatalog } from '../../core/settings/profile-catalog'
import type { RecognitionEngine } from '../../core/contracts/engine'
import type { ResolvedRuntimeConfig } from '../../shared/api-types'
import { EngineRegistry } from './engine-registry'
import { LocalServiceSupervisor } from './local-service-supervisor'
import { SpeechService } from './speech-service'

describe('SpeechService', () => {
  it('lists profiles from the registry', async () => {
    const service = createSpeechService()

    await expect(service.listProfiles()).resolves.toEqual(
      expect.arrayContaining(exposedProfileCatalog.map((profile) => expect.objectContaining({ id: profile.id })))
    )
    await expect(service.listProfiles()).resolves.toHaveLength(exposedProfileCatalog.length)
    await expect(service.listProfiles()).resolves.not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'cloud-low-cost' })])
    )
  })

  it('tests a local profile and reports capabilities plus local service status', async () => {
    const service = createSpeechService()

    await expect(service.testProfile('local-fast')).resolves.toMatchObject({
      ok: true,
      profileId: 'local-fast',
      localService: 'healthy',
      capabilities: {
        streaming: true
      }
    })
  })

  it('returns a structured error for an unknown profile', async () => {
    const service = createSpeechService()

    await expect(service.testProfile('missing')).resolves.toMatchObject({
      ok: false,
      profileId: 'missing',
      error: {
        code: 'E_INVALID_SETTINGS'
      }
    })
  })

  it('restarts the local service through the supervisor', async () => {
    const restart = vi.fn(async () => 'healthy' as const)
    const service = createSpeechService({
      restart
    })

    await service.restartLocalService()

    expect(restart).toHaveBeenCalled()
  })

  it('probes the local service through the supervisor without starting it', async () => {
    const probe = vi.fn(async () => 'healthy' as const)
    const service = createSpeechService({
      probe
    })

    await expect(service.probeLocalService()).resolves.toBe('healthy')

    expect(probe).toHaveBeenCalled()
  })
})

function createSpeechService(overrides: {
  restart?: () => Promise<'healthy' | 'degraded' | 'starting' | 'stopped' | 'failed'>
  probe?: () => Promise<'healthy' | 'degraded' | 'starting' | 'stopped' | 'failed'>
} = {}): SpeechService {
  const registry = new EngineRegistry(profileCatalog, (config) => new FakeRecognitionEngine(config))
  const localServiceSupervisor = new LocalServiceSupervisor({
    async start() {},
    async stop() {},
    async healthCheck() {
      return { ok: true }
    }
  })
  if (overrides.restart) {
    localServiceSupervisor.restart = overrides.restart as LocalServiceSupervisor['restart']
  }
  if (overrides.probe) {
    localServiceSupervisor.probe = overrides.probe as LocalServiceSupervisor['probe']
  }

  return new SpeechService(registry, localServiceSupervisor, {
    async resolveProfileRuntimeConfig(profileId) {
      const profile = profileCatalog.find((item) => item.id === profileId)

      if (!profile) {
        throw new Error(`Unknown engine profile: ${profileId}`)
      }

      return {
        engineProfile: profile,
        engineConfig: {},
        captureConfig: {
          sampleRate: 16000,
          chunkMs: 100
        },
        outputConfig: {
          method: 'simulate_input'
        }
      } satisfies ResolvedRuntimeConfig
    }
  })
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
