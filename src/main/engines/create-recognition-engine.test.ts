import { describe, expect, it } from 'vitest'
import { profileCatalog } from '../../core/settings/profile-catalog'
import type { ResolvedRuntimeConfig } from '../../shared/api-types'
import { LocalServiceSupervisor } from '../services/local-service-supervisor'
import { createRecognitionEngine } from './create-recognition-engine'
import { LocalEngineAdapter } from './local-engine-adapter'

describe('createRecognitionEngine', () => {
  it('creates a local engine adapter for local profiles', () => {
    const engine = createRecognitionEngine(createConfig(profileCatalog[0]!), {
      localServiceSupervisor: createLocalServiceSupervisor()
    })

    expect(engine).toBeInstanceOf(LocalEngineAdapter)
  })

  it('returns a structured unsupported engine for cloud profiles', async () => {
    const engine = createRecognitionEngine(createConfig(profileCatalog[2]!), {
      localServiceSupervisor: createLocalServiceSupervisor()
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

function createLocalServiceSupervisor(): LocalServiceSupervisor {
  return new LocalServiceSupervisor({
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
}
