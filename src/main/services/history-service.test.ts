import { describe, expect, it } from 'vitest'

import type {
  ExportFormat,
  ExportResult,
  SavedTranscript
} from '../../shared/api-types'
import type { TranscriptExporter, TranscriptRepository } from '../../core/contracts/storage'
import { InMemoryTranscriptRepository } from '../persistence/transcript-repository'
import { HistoryService } from './history-service'

describe('HistoryService', () => {
  it('delegates list, search, get, and delete to the transcript repository', async () => {
    const repository = new InMemoryTranscriptRepository()
    const service = new HistoryService(repository)
    const transcript = createTranscript({
      id: 'tx-1',
      title: 'Weekly Sync',
      plainText: 'planning notes',
      startedAt: 1000
    })

    await repository.save(transcript)

    expect((await service.list()).items.map((item) => item.id)).toEqual(['tx-1'])
    expect((await service.search({ query: 'planning' })).items.map((item) => item.id)).toEqual(['tx-1'])
    expect(await service.get('tx-1')).toEqual(transcript)
    expect(await service.delete('tx-1')).toBe(true)
  })

  it('returns a clear fallback when export is unavailable', async () => {
    const service = new HistoryService(new InMemoryTranscriptRepository())

    await expect(service.export('tx-1', 'json')).resolves.toEqual({
      ok: false,
      error: 'History export is not implemented'
    })
  })

  it('delegates export to the configured exporter', async () => {
    const exporter = new FakeTranscriptExporter()
    const service = new HistoryService(new InMemoryTranscriptRepository(), exporter)

    await expect(service.export('tx-2', 'plain_text')).resolves.toEqual({
      ok: true,
      path: 'C:/exports/tx-2.txt'
    })
    expect(exporter.calls).toEqual([
      {
        id: 'tx-2',
        format: 'plain_text'
      }
    ])
  })
})

class FakeTranscriptExporter implements TranscriptExporter {
  readonly calls: Array<{ id: string; format: ExportFormat }> = []

  async export(id: string, format: ExportFormat): Promise<ExportResult> {
    this.calls.push({ id, format })

    return {
      ok: true,
      path: `C:/exports/${id}.txt`
    }
  }
}

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
      translationEnabled: false
    },
    ...(overrides.targetLanguage !== undefined ? { targetLanguage: overrides.targetLanguage } : {}),
    ...(overrides.translatedPlainText !== undefined
      ? { translatedPlainText: overrides.translatedPlainText }
      : {})
  }
}
