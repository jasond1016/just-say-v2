import { describe, expect, it } from 'vitest'

import { createDefaultSettings } from '../../core/settings/settings-schema'
import { InMemorySettingsRepository } from './settings-repository'

describe('InMemorySettingsRepository', () => {
  it('returns null until settings are saved', async () => {
    const repository = new InMemorySettingsRepository()

    await expect(repository.get()).resolves.toBeNull()
  })

  it('saves and returns cloned settings', async () => {
    const repository = new InMemorySettingsRepository()
    const settings = createDefaultSettings()

    settings.advanced.experimentalFlags.push('exp-a')
    await repository.save(settings)

    const loaded = await repository.get()
    loaded?.advanced.experimentalFlags.push('exp-b')

    expect(await repository.get()).toMatchObject({
      advanced: {
        experimentalFlags: ['exp-a']
      }
    })
  })
})
