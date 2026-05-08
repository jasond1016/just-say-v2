import { describe, expect, it } from 'vitest'

import { InMemorySettingsRepository } from '../persistence/settings-repository'
import { SettingsService } from './settings-service'

describe('SettingsService', () => {
  it('returns defaults when no settings have been saved', async () => {
    const service = new SettingsService(new InMemorySettingsRepository())

    await expect(service.getSettings()).resolves.toMatchObject({
      speech: {
        selectedProfileId: 'local-fast'
      }
    })
  })

  it('applies patches, normalizes values, and persists the result', async () => {
    const repository = new InMemorySettingsRepository()
    const service = new SettingsService(repository)

    const updated = await service.updateSettings({
      speech: {
        selectedProfileId: 'missing-profile'
      },
      advanced: {
        localServicePort: 99999
      }
    })

    expect(updated).toMatchObject({
      speech: {
        selectedProfileId: 'local-fast'
      },
      advanced: {
        localServicePort: 8765
      }
    })
    await expect(repository.get()).resolves.toEqual(updated)
  })

  it('resolves runtime config using stored settings and provider hooks', async () => {
    const repository = new InMemorySettingsRepository()
    const service = new SettingsService(repository, {
      credentialsProvider: () => ({
        translationApiKey: 'translation-secret'
      }),
      platformProvider: () => ({
        localServiceAvailable: true
      })
    })

    await service.updateSettings({
      translation: {
        enabledForMeeting: true
      }
    })

    await expect(service.resolveRuntimeConfig('meeting')).resolves.toMatchObject({
      engineProfile: {
        id: 'local-fast'
      },
      translationConfig: {
        targetLanguage: 'en'
      }
    })
  })
})
