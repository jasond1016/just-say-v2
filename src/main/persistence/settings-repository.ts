import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { AppSettings } from '../../shared/api-types'
import { createDefaultSettings } from '../../core/settings/settings-schema'

export interface SettingsRepository {
  get(): Promise<AppSettings | null>
  save(settings: AppSettings): Promise<void>
}

export class InMemorySettingsRepository implements SettingsRepository {
  private settings: AppSettings | null = null

  async get(): Promise<AppSettings | null> {
    return this.settings ? cloneSettings(this.settings) : null
  }

  async save(settings: AppSettings): Promise<void> {
    this.settings = cloneSettings(settings)
  }
}

export class FileSettingsRepository implements SettingsRepository {
  constructor(private readonly filePath: string) {}

  async get(): Promise<AppSettings | null> {
    try {
      const serialized = await readFile(this.filePath, 'utf8')
      const parsed = JSON.parse(serialized) as AppSettings
      return cloneSettings(parsed)
    } catch (error) {
      if (isFileNotFoundError(error)) {
        return null
      }

      throw error
    }
  }

  async save(settings: AppSettings): Promise<void> {
    const directory = path.dirname(this.filePath)
    await mkdir(directory, { recursive: true })

    const tempPath = `${this.filePath}.tmp`
    await writeFile(tempPath, JSON.stringify(settings, null, 2), 'utf8')
    await rename(tempPath, this.filePath)
  }
}

export function cloneSettings(settings: AppSettings): AppSettings {
  const defaults = createDefaultSettings()

  return {
    general: {
      ...defaults.general,
      ...settings.general
    },
    speech: {
      ...defaults.speech,
      ...settings.speech
    },
    input: {
      ...defaults.input,
      ...settings.input
    },
    output: {
      ...defaults.output,
      ...settings.output
    },
    translation: {
      ...defaults.translation,
      ...settings.translation
    },
    advanced: {
      ...defaults.advanced,
      ...settings.advanced,
      experimentalFlags: [...settings.advanced.experimentalFlags]
    }
  }
}

function isFileNotFoundError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}
