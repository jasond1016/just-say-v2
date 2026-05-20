import { describe, expect, it } from 'vitest'

import type { EngineProfile } from '../../shared/api-types'
import { profileCatalog } from './profile-catalog'
import { resolveRuntimeConfig, SettingsResolverError } from './settings-resolver'
import { DEFAULT_SETTINGS } from './settings-schema'

describe('resolveRuntimeConfig', () => {
  it('resolves a local profile with local service wiring and no translation by default', () => {
    const config = resolveRuntimeConfig({
      settings: DEFAULT_SETTINGS,
      mode: 'meeting'
    })

    expect(config.engineProfile.id).toBe('local-fast')
    expect(config.engineConfig).toMatchObject({
      mode: 'meeting',
      profileId: 'local-fast',
      preset: 'local-fast',
      language: 'auto',
      diagnosticsEnabled: true,
      localService: {
        mode: 'managed-local',
        host: '127.0.0.1',
        port: 8765
      }
    })
    expect(config.translationConfig).toBeUndefined()
    expect(config.captureConfig).toEqual({
      sampleRate: 16000,
      chunkMs: 100
    })
    expect(config.outputConfig).toEqual({
      method: 'simulate_input'
    })
  })

  it('enables translation per mode and requires translation credentials', () => {
    const config = resolveRuntimeConfig({
      settings: {
        ...DEFAULT_SETTINGS,
        translation: {
          ...DEFAULT_SETTINGS.translation,
          enabledForMeeting: true,
          targetLanguage: 'ja',
          endpoint: 'https://example.test/v1',
          model: 'demo-model'
        }
      },
      mode: 'meeting',
      credentials: {
        translationApiKey: 'translation-secret'
      }
    })

    expect(config.translationConfig).toMatchObject({
      provider: 'openai-compatible',
      targetLanguage: 'ja',
      sourceLanguage: 'auto',
      endpoint: 'https://example.test/v1',
      model: 'demo-model',
      credentials: {
        translationApiKey: 'translation-secret'
      }
    })
  })

  it('does not enable meeting translation for ptt resolution', () => {
    const config = resolveRuntimeConfig({
      settings: {
        ...DEFAULT_SETTINGS,
        translation: {
          ...DEFAULT_SETTINGS.translation,
          enabledForMeeting: true
        }
      },
      mode: 'ptt'
    })

    expect(config.translationConfig).toBeUndefined()
  })

  it('uses the dedicated remote endpoint when remote service mode is selected', () => {
    const config = resolveRuntimeConfig({
      settings: {
        ...DEFAULT_SETTINGS,
        advanced: {
          ...DEFAULT_SETTINGS.advanced,
          localServiceMode: 'remote-service',
          remoteServiceHost: '10.0.0.8',
          remoteServicePort: 9001
        }
      },
      mode: 'meeting'
    })

    expect(config.engineConfig).toMatchObject({
      localService: {
        mode: 'remote-service',
        host: '10.0.0.8',
        port: 9001
      }
    })
  })

  it('allows local-accurate to resolve as managed-local when the platform supports qwen3-asr', () => {
    const config = resolveRuntimeConfig({
      settings: {
        ...DEFAULT_SETTINGS,
        speech: {
          ...DEFAULT_SETTINGS.speech,
          selectedProfileId: 'local-accurate'
        }
      },
      mode: 'meeting',
      platform: {
        supportedManagedLocalRuntimes: ['sensevoice', 'qwen3-asr']
      }
    })

    expect(config.engineProfile.id).toBe('local-accurate')
    expect(config.engineConfig.localService).toMatchObject({
      mode: 'managed-local',
      runtimeFamilyId: 'qwen3-asr',
      modelIdentifier: 'Qwen/Qwen3-ASR-1.7B'
    })
  })

  it('requires a remote host when remote service mode is selected', () => {
    expect(() =>
      resolveRuntimeConfig({
        settings: {
          ...DEFAULT_SETTINGS,
          advanced: {
            ...DEFAULT_SETTINGS.advanced,
            localServiceMode: 'remote-service'
          }
        },
        mode: 'meeting'
      })
    ).toThrowError(SettingsResolverError)
  })

  it('requires cloud credentials for cloud profiles', () => {
    expect(() =>
      resolveRuntimeConfig({
        settings: {
          ...DEFAULT_SETTINGS,
          speech: {
            ...DEFAULT_SETTINGS.speech,
            selectedProfileId: 'cloud-low-latency'
          }
        },
        mode: 'meeting'
      })
    ).toThrowError(SettingsResolverError)

    expect(() =>
      resolveRuntimeConfig({
        settings: {
          ...DEFAULT_SETTINGS,
          speech: {
            ...DEFAULT_SETTINGS.speech,
            selectedProfileId: 'cloud-low-latency'
          }
        },
        mode: 'meeting',
        credentials: {
          cloudApiKey: 'cloud-secret'
        }
      })
    ).not.toThrow()
  })

  it('fails when platform capabilities do not satisfy the selected profile', () => {
    expect(() =>
      resolveRuntimeConfig({
        settings: DEFAULT_SETTINGS,
        mode: 'meeting',
        platform: {
          localServiceAvailable: false
        }
      })
    ).toThrowError(SettingsResolverError)

    expect(() =>
      resolveRuntimeConfig({
        settings: {
          ...DEFAULT_SETTINGS,
          speech: {
            ...DEFAULT_SETTINGS.speech,
            selectedProfileId: 'cloud-low-cost'
          }
        },
        mode: 'meeting',
        credentials: {
          cloudApiKey: 'cloud-secret'
        },
        platform: {
          hasNetwork: false
        }
      })
    ).toThrowError(SettingsResolverError)
  })

  it('fails cleanly on unknown profiles when an explicit catalog is supplied', () => {
    const customCatalog: EngineProfile[] = profileCatalog.filter((profile) => profile.kind === 'local')

    expect(() =>
      resolveRuntimeConfig({
        settings: {
          ...DEFAULT_SETTINGS,
          speech: {
            ...DEFAULT_SETTINGS.speech,
            selectedProfileId: 'cloud-low-cost'
          }
        },
        mode: 'ptt',
        profiles: customCatalog
      })
    ).toThrowError(SettingsResolverError)
  })

  it('allows translation with a non-translating recognition profile', () => {
    const config = resolveRuntimeConfig({
      settings: {
        ...DEFAULT_SETTINGS,
        translation: {
          ...DEFAULT_SETTINGS.translation,
          enabledForPtt: true
        }
      },
      mode: 'ptt',
      credentials: {
        translationApiKey: 'translation-secret'
      }
    })

    expect(config.engineProfile.capabilities.translation).toBe(false)
    expect(config.translationConfig).toMatchObject({
      provider: 'openai-compatible',
      targetLanguage: 'en'
    })
  })
})
