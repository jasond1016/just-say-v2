import { describe, expect, it, vi } from 'vitest'

import type {
  ExportFormat,
  ExportResult,
  HistoryAudioPlayback,
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
    await expect(service.copy('tx-1', 'plain_text')).rejects.toThrow('History copy is not implemented')
  })

  it('delegates export to the configured exporter', async () => {
    const exporter = new FakeTranscriptExporter()
    const clipboard = {
      writeText: vi.fn(async () => undefined)
    }
    const repository = new InMemoryTranscriptRepository()
    await repository.save(
      createTranscript({
        id: 'tx-2',
        plainText: 'plain body',
        translatedPlainText: 'bilingual body'
      })
    )
    const service = new HistoryService(repository, exporter, clipboard)

    await expect(service.export('tx-2', 'plain_text')).resolves.toEqual({
      ok: true,
      path: 'C:/exports/tx-2.txt'
    })
    await service.copy('tx-2', 'bilingual_text')
    expect(exporter.calls).toEqual([
      {
        id: 'tx-2',
        format: 'plain_text'
      }
    ])
    expect(clipboard.writeText).toHaveBeenCalledWith('plain body\n\nbilingual body')
  })

  it('returns playback info for saved meeting audio and cleans it up on delete', async () => {
    const audioStorage = new FakeAudioStorage()
    const repository = new InMemoryTranscriptRepository()
    const transcript = createTranscript({
      id: 'tx-audio',
      metadata: {
        engineProfileId: 'local-fast',
        includeMicrophone: true,
        translationEnabled: false,
        audio: {
          relativePath: 'meetings\\2026\\tx-audio.wav',
          format: 'wav',
          sampleRate: 16000,
          channels: 1,
          status: 'partial',
          durationMs: 1200,
          byteLength: 38444
        }
      }
    })
    await repository.save(transcript)
    const service = new HistoryService(repository, undefined, undefined, audioStorage)

    await expect(service.getAudioPlayback('tx-audio')).resolves.toEqual({
      url: 'file:///C:/audio/tx-audio.wav',
      status: 'partial'
    })
    await expect(service.delete('tx-audio')).resolves.toBe(true)

    expect(audioStorage.seenTranscripts).toEqual(['tx-audio', 'tx-audio'])
    expect(audioStorage.deletedTranscripts).toEqual(['tx-audio'])
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

class FakeAudioStorage {
  readonly seenTranscripts: string[] = []
  readonly deletedTranscripts: string[] = []

  async getPlayback(transcript: SavedTranscript): Promise<HistoryAudioPlayback | null> {
    this.seenTranscripts.push(transcript.id)
    return {
      url: 'file:///C:/audio/tx-audio.wav',
      status: transcript.metadata.audio?.status ?? 'complete'
    }
  }

  async deleteForTranscript(transcript: SavedTranscript): Promise<void> {
    this.seenTranscripts.push(transcript.id)
    this.deletedTranscripts.push(transcript.id)
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
