import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

export type StoredCredentials = {
  translationApiKey?: string
}

export type SecureStorageLike = {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
}

export class SecureStorageUnavailableError extends Error {
  constructor(message = 'Secure credential storage is not available on this device') {
    super(message)
    this.name = 'SecureStorageUnavailableError'
  }
}

export class FileCredentialsRepository {
  constructor(
    private readonly filePath: string,
    private readonly secureStorage: SecureStorageLike
  ) {}

  async get(): Promise<StoredCredentials | undefined> {
    try {
      const encrypted = await readFile(this.filePath)
      this.assertEncryptionAvailable()
      const decrypted = this.secureStorage.decryptString(encrypted)
      return normalizeStoredCredentials(JSON.parse(decrypted) as StoredCredentials)
    } catch (error) {
      if (isFileNotFoundError(error)) {
        return undefined
      }

      throw error
    }
  }

  async save(credentials: StoredCredentials): Promise<void> {
    this.assertEncryptionAvailable()
    const directory = path.dirname(this.filePath)
    await mkdir(directory, { recursive: true })

    const serialized = JSON.stringify(normalizeStoredCredentials(credentials))
    const encrypted = this.secureStorage.encryptString(serialized)
    const tempPath = `${this.filePath}.tmp`
    await writeFile(tempPath, encrypted)
    await rename(tempPath, this.filePath)
  }

  private assertEncryptionAvailable(): void {
    if (!this.secureStorage.isEncryptionAvailable()) {
      throw new SecureStorageUnavailableError()
    }
  }
}

function normalizeStoredCredentials(credentials: StoredCredentials): StoredCredentials {
  return {
    ...(credentials.translationApiKey?.trim()
      ? { translationApiKey: credentials.translationApiKey.trim() }
      : {})
  }
}

function isFileNotFoundError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}
