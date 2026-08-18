import { describe, expect, it } from 'vitest'
import { profileCatalog } from '../../core/settings/profile-catalog'
import type { ResolvedRuntimeConfig } from '../../shared/api-types'
import { establishRuntimeReadiness } from '../services/runtime-readiness'
import { LocalServiceSupervisor } from '../services/local-service-supervisor'
import { createRecognitionEngine } from './create-recognition-engine'
import { LocalEngineAdapter } from './local-engine-adapter'
import { SenseVoiceRealtimeEngineAdapter } from './sensevoice-realtime-engine-adapter'

describe('createRecognitionEngine', () => {
  it('creates a local engine adapter for local profiles', () => {
    const engine = createRecognitionEngine(createConfig(profileCatalog[0]!), {
      establishReadiness: createEstablishReadiness()
    })

    expect(engine).toBeInstanceOf(LocalEngineAdapter)
  })

  it('creates the native SenseVoice adapter for the experimental realtime protocol', () => {
    const config = createConfig(profileCatalog[0]!)
    config.engineConfig.localService = {
      ...config.engineConfig.localService!,
      protocol: 'openai-realtime'
    }
    const engine = createRecognitionEngine(config, {
      establishReadiness: createEstablishReadiness()
    })

    expect(engine).toBeInstanceOf(SenseVoiceRealtimeEngineAdapter)
  })

  it('returns a structured unsupported engine for cloud profiles', async () => {
    const cloudProfile = profileCatalog.find((profile) => profile.kind === 'cloud')
    expect(cloudProfile).toBeDefined()
    const engine = createRecognitionEngine(createConfig(cloudProfile!), {
      establishReadiness: createEstablishReadiness()
    })

    await expect(engine.warmup({ mode: 'meeting', language: 'en' })).rejects.toMatchObject({
      payload: {
        code: 'E_ENGINE_UNAVAILABLE'
      }
    })
  })
})

function createConfig(profile: ResolvedRuntimeConfig['engineProfile']): ResolvedRuntimeConfig {
  return {
    engineProfile: profile,
    engineConfig: {
      mode: 'meeting',
      profileId: profile.id,
      preset: profile.preset,
      language: 'auto',
      diagnosticsEnabled: true,
      experimentalFlags: [],
      localService: {
        host: '127.0.0.1',
        port: 8765,
        mode: 'managed-local',
        runtimeFamilyId: 'sensevoice',
        modelIdentifier: profile.modelIdentifier
      }
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

function createEstablishReadiness() {
  const supervisor = new LocalServiceSupervisor({
    async start() {},
    async stop() {},
    async healthCheck(target) {
      return {
        ok: true,
        runtimeFamilyId: target.runtimeFamilyId,
        modelIdentifier: target.modelIdentifier,
        readiness: 'ready'
      }
    },
    async prewarm(target) {
      return {
        ok: true,
        runtimeFamilyId: target.runtimeFamilyId,
        modelIdentifier: target.modelIdentifier,
        readiness: 'ready'
      }
    }
  })

  return (input: { mode: 'meeting' | 'ptt'; language: string }) => {
    const config = createConfig(profileCatalog[0]!)
    const target = config.engineConfig.localService!

    return establishRuntimeReadiness(
      { supervisor },
      {
        target,
        runtimeFamilyId: config.engineProfile.runtimeFamilyId,
        expectedIdentity: {
          runtimeFamilyId: config.engineProfile.runtimeFamilyId,
          modelIdentifier: config.engineProfile.modelIdentifier
        },
        mode: input.mode,
        language: input.language,
        intent: 'session-start'
      }
    )
  }
}
