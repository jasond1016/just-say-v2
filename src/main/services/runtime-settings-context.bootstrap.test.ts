import { describe, expect, it } from 'vitest'

import { DEFAULT_SETTINGS } from '../../core/settings/settings-schema'
import { SettingsResolverError } from '../../core/settings/settings-resolver'
import { InMemorySettingsRepository } from '../persistence/settings-repository'
import { RuntimeSettingsContext } from './runtime-settings-context'
import { SettingsService } from './settings-service'

describe('RuntimeSettingsContext bootstrap credential wiring', () => {
  it('resolves meeting translation when credentials exist before context create', async () => {
    const repository = new InMemorySettingsRepository()
    await repository.save({
      ...DEFAULT_SETTINGS,
      translation: {
        ...DEFAULT_SETTINGS.translation,
        enabledForMeeting: true
      }
    })

    const credentialsRepository = {
      store: { translationApiKey: 'translation-secret' } as { translationApiKey?: string },
      async get() {
        return { ...this.store }
      },
      async save(credentials: { translationApiKey?: string }) {
        Object.assign(this.store, credentials)
      }
    }

    const settingsService = new SettingsService(repository)
    const runtimeSettings = await RuntimeSettingsContext.create({
      settingsService,
      credentialsRepository
    })

    const provider = runtimeSettings.createSettingsProvider()
    const resolver = runtimeSettings.createRuntimeConfigResolver()

    expect(() => provider.resolveRuntimeConfig('meeting')).not.toThrow()
    expect(provider.resolveRuntimeConfig('meeting').translationConfig).toMatchObject({
      credentials: { translationApiKey: 'translation-secret' }
    })
    await expect(resolver.resolveRuntimeConfig('meeting')).resolves.toMatchObject({
      translationConfig: {
        credentials: { translationApiKey: 'translation-secret' }
      }
    })
    expect(runtimeSettings.getSettings().translation.apiKeyConfigured).toBe(true)
  })

  it('surfaces the missing translation credential error when starting with translation enabled and no key', async () => {
    const repository = new InMemorySettingsRepository()
    await repository.save({
      ...DEFAULT_SETTINGS,
      translation: {
        ...DEFAULT_SETTINGS.translation,
        enabledForMeeting: true
      }
    })

    const settingsService = new SettingsService(repository)
    const credentialsRepository = {
      async get() {
        return {}
      },
      async save() {}
    }

    const runtimeSettings = await RuntimeSettingsContext.create({
      settingsService,
      credentialsRepository
    })

    expect(() => runtimeSettings.createSettingsProvider().resolveRuntimeConfig('meeting')).toThrow(
      SettingsResolverError
    )
  })
})
