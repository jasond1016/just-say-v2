import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { createDefaultSettings } from '../../core/settings/settings-schema'
import { FileSettingsRepository, InMemorySettingsRepository } from './settings-repository'

const tempDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) =>
      rm(directory, {
        recursive: true,
        force: true
      })
    )
  )
})

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

describe('FileSettingsRepository', () => {
  it('returns null until settings are saved', async () => {
    const repository = new FileSettingsRepository(await createTempFilePath('settings.json'))

    await expect(repository.get()).resolves.toBeNull()
  })

  it('persists settings to disk and returns cloned settings', async () => {
    const filePath = await createTempFilePath('settings.json')
    const repository = new FileSettingsRepository(filePath)
    const settings = createDefaultSettings()

    settings.general.theme = 'dark'
    settings.advanced.experimentalFlags.push('exp-a')
    await repository.save(settings)

    const serialized = await readFile(filePath, 'utf8')
    expect(JSON.parse(serialized)).toMatchObject({
      general: {
        theme: 'dark'
      },
      advanced: {
        experimentalFlags: ['exp-a']
      }
    })

    const reloaded = new FileSettingsRepository(filePath)
    const loaded = await reloaded.get()
    loaded?.advanced.experimentalFlags.push('exp-b')

    expect(await reloaded.get()).toMatchObject({
      general: {
        theme: 'dark'
      },
      advanced: {
        experimentalFlags: ['exp-a']
      }
    })
  })

  it('creates the parent directory when saving settings', async () => {
    const filePath = await createTempFilePath(path.join('nested', 'settings.json'))
    const repository = new FileSettingsRepository(filePath)

    await repository.save(createDefaultSettings())

    await expect(readFile(filePath, 'utf8')).resolves.toContain('"general"')
  })
})

async function createTempFilePath(filename: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'justsay-settings-'))
  tempDirectories.push(directory)
  return path.join(directory, filename)
}
