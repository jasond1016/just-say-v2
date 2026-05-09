import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import type { SavedTranscript } from '../../shared/api-types'
import { InMemoryTranscriptRepository } from './transcript-repository'
import { FileTranscriptExporter } from './file-transcript-exporter'

describe('FileTranscriptExporter', () => {
  it('writes transcript exports to disk', async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'justsay-export-'))

    try {
      const repository = new InMemoryTranscriptRepository()
      await repository.save(
        createTranscript({
          id: 'tx-1',
          title: 'Weekly Sync',
          plainText: 'hello world',
          translatedPlainText: '你好世界'
        })
      )
      const exporter = new FileTranscriptExporter(repository, tempDir)

      const result = await exporter.export('tx-1', 'bilingual_text')

      expect(result.ok).toBe(true)
      expect(result.path).toBeDefined()
      expect(readFileSync(result.path!, 'utf8')).toContain('你好世界')
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('returns a clear error when the transcript is missing', async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'justsay-export-'))

    try {
      const exporter = new FileTranscriptExporter(new InMemoryTranscriptRepository(), tempDir)

      await expect(exporter.export('missing', 'json')).resolves.toEqual({
        ok: false,
        error: 'Transcript not found: missing'
      })
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })
})

function createTranscript(overrides: Partial<SavedTranscript> & Pick<SavedTranscript, 'id'>): SavedTranscript {
  const startedAt = overrides.startedAt ?? 1000
  const endedAt = overrides.endedAt ?? startedAt + 500
  const plainText = overrides.plainText ?? 'sample transcript'

  return {
    id: overrides.id,
    mode: overrides.mode ?? 'meeting',
    title: overrides.title ?? `Transcript ${overrides.id}`,
    startedAt,
    endedAt,
    language: overrides.language ?? 'auto',
    plainText,
    blocks:
      overrides.blocks ??
      [
        {
          id: `${overrides.id}-block-1`,
          source: 'microphone',
          text: plainText,
          startedAt,
          endedAt
        }
      ],
    metadata: overrides.metadata ?? {
      engineProfileId: 'local-fast',
      includeMicrophone: true,
      translationEnabled: Boolean(overrides.translatedPlainText)
    },
    ...(overrides.targetLanguage !== undefined ? { targetLanguage: overrides.targetLanguage } : {}),
    ...(overrides.translatedPlainText !== undefined
      ? { translatedPlainText: overrides.translatedPlainText }
      : {})
  }
}
