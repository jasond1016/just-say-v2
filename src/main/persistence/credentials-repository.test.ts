import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  FileCredentialsRepository,
  SecureStorageUnavailableError,
  type SecureStorageLike
} from './credentials-repository'

describe('FileCredentialsRepository', () => {
  let tempDir: string | null = null

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true })
      tempDir = null
    }
  })

  it('round-trips encrypted translation credentials through the filesystem', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'justsay-creds-'))
    const repository = new FileCredentialsRepository(
      path.join(tempDir, 'translation-credentials.bin'),
      createSecureStorageStub()
    )

    await repository.save({
      translationApiKey: ' translation-secret '
    })

    await expect(repository.get()).resolves.toEqual({
      translationApiKey: 'translation-secret'
    })
  })

  it('throws a dedicated error when encryption is unavailable for saving', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'justsay-creds-'))
    const repository = new FileCredentialsRepository(
      path.join(tempDir, 'translation-credentials.bin'),
      {
        isEncryptionAvailable: () => false,
        encryptString: () => Buffer.alloc(0),
        decryptString: () => ''
      }
    )

    await expect(
      repository.save({
        translationApiKey: 'translation-secret'
      })
    ).rejects.toBeInstanceOf(SecureStorageUnavailableError)
  })
})

function createSecureStorageStub(): SecureStorageLike {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`enc:${value}`, 'utf8'),
    decryptString: (value) => value.toString('utf8').replace(/^enc:/, '')
  }
}
