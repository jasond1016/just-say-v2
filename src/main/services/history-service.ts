import type {
  ExportFormat,
  ExportResult,
  HistoryAudioPlayback,
  HistoryListQuery,
  HistorySearchQuery,
  PaginatedHistoryResult,
  SavedTranscript
} from '../../shared/api-types'
import type { TranscriptExporter, TranscriptRepository } from '../../core/contracts/storage'

export class HistoryService {
  constructor(
    private readonly repository: TranscriptRepository,
    private readonly exporter?: TranscriptExporter,
    private readonly clipboard?: {
      writeText(text: string): Promise<void>
    },
    private readonly audioStorage?: {
      getPlayback(transcript: SavedTranscript): Promise<HistoryAudioPlayback | null>
      deleteForTranscript(transcript: SavedTranscript): Promise<void>
    }
  ) {}

  async list(query: HistoryListQuery = {}): Promise<PaginatedHistoryResult> {
    return this.repository.list(query)
  }

  async search(query: HistorySearchQuery): Promise<PaginatedHistoryResult> {
    return this.repository.search(query)
  }

  async get(id: string): Promise<SavedTranscript | null> {
    return this.repository.getById(id)
  }

  async delete(id: string): Promise<boolean> {
    const transcript = await this.repository.getById(id)
    const deleted = await this.repository.delete(id)

    if (deleted && transcript && this.audioStorage) {
      try {
        await this.audioStorage.deleteForTranscript(transcript)
      } catch (error) {
        console.warn(
          '[history] Failed to delete stored meeting audio',
          error instanceof Error ? error.message : error
        )
      }
    }

    return deleted
  }

  async export(id: string, format: ExportFormat): Promise<ExportResult> {
    if (!this.exporter) {
      return {
        ok: false,
        error: 'History export is not implemented'
      }
    }

    return this.exporter.export(id, format)
  }

  async copy(id: string, format: ExportFormat): Promise<void> {
    if (!this.clipboard) {
      throw new Error('History copy is not implemented')
    }

    const transcript = await this.repository.getById(id)

    if (!transcript) {
      throw new Error(`Transcript not found: ${id}`)
    }

    const text =
      format === 'json'
        ? JSON.stringify(transcript, null, 2)
        : format === 'bilingual_text'
          ? [transcript.plainText, transcript.translatedPlainText ?? ''].filter(Boolean).join('\n\n')
          : transcript.plainText

    await this.clipboard.writeText(text)
  }

  async getAudioPlayback(id: string): Promise<HistoryAudioPlayback | null> {
    if (!this.audioStorage) {
      return null
    }

    const transcript = await this.repository.getById(id)

    if (!transcript) {
      return null
    }

    return this.audioStorage.getPlayback(transcript)
  }
}
