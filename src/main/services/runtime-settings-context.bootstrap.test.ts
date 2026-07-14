import { describe, expect, it } from 'vitest'

import { DEFAULT_SETTINGS } from '../../core/settings/settings-schema'
import type { ResolverCredentials } from '../../core/settings/settings-resolver'
import { SettingsResolverError } from '../../core/settings/settings-resolver'
import { InMemorySettingsRepository } from '../persistence/settings-repository'
import { RuntimeSettingsContext } from './runtime-settings-context'
import { SettingsService } from './settings-service'

describe('RuntimeSettingsContext bootstrap credential wiring', () => {
  it('resolves meeting translation after create when credentials exist before bootstrap', async () => {
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

    // Mirrors create-runtime.ts: stub first, wire after RuntimeSettingsContext.create
    const credentialsProvider = {
      getRuntimeCredentials: (): ResolverCredentials | undefined => undefined
    }
    const settingsService = new SettingsService(repository, {
      credentialsProvider: () => credentialsProvider.getRuntimeCredentials()
    })

    const runtimeSettings = await RuntimeSettingsContext.create({
      settingsService,
      credentialsRepository
    })
    credentialsProvider.getRuntimeCredentials = () => runtimeSettings.getRuntimeCredentials()

    const provider = runtimeSettings.createSettingsProvider()

    expect(() => provider.resolveRuntimeConfig('meeting')).not.toThrow()
    expect(provider.resolveRuntimeConfig('meeting').translationConfig).toMatchObject({
      credentials: { translationApiKey: 'translation-secret' }
    })
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

    const credentialsProvider = {
      getRuntimeCredentials: (): ResolverCredentials | undefined => undefined
    }
    const settingsService = new SettingsService(repository, {
      credentialsProvider: () => credentialsProvider.getRuntimeCredentials()
    })
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
    credentialsProvider.getRuntimeCredentials = () => runtimeSettings.getRuntimeCredentials()

    expect(() => runtimeSettings.createSettingsProvider().resolveRuntimeConfig('meeting')).toThrow(
      SettingsResolverError
    )
  })
})
