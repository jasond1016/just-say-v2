import type {
  ExportFormat,
  ExportResult,
  HistoryAudioPlayback,
  HistoryListQuery,
  HistoryNotesGenerateOptions,
  HistorySearchQuery,
  PaginatedHistoryResult,
  SavedTranscript,
  TranscriptNotes,
  TranscriptNotesRuntimeConfig
} from '../../shared/api-types'
import type { TranscriptExporter, TranscriptNotesRepository, TranscriptRepository } from '../../core/contracts/storage'
import type { NotesGenerationService } from './notes-generation-service'

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
    },
    private readonly notes?: {
      repository: TranscriptNotesRepository
      generationService: NotesGenerationService
      configProvider: () => TranscriptNotesRuntimeConfig
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

  async getNotes(id: string): Promise<TranscriptNotes | null> {
    if (!this.notes) {
      return null
    }

    return this.notes.repository.getNotesByTranscriptId(id)
  }

  async generateNotes(id: string, options: HistoryNotesGenerateOptions = {}): Promise<TranscriptNotes> {
    if (!this.notes) {
      throw new Error('History notes are not configured')
    }

    const transcript = await this.repository.getById(id)

    if (!transcript) {
      throw new Error(`Transcript not found: ${id}`)
    }

    const runtimeConfig = this.notes.configProvider()
    const cachedNotes = options.force ? null : await this.notes.repository.getNotesByTranscriptId(id)
    const transcriptHash = this.notes.generationService.computeTranscriptHash(transcript)
    const resolvedModel = runtimeConfig.model?.trim() || 'gpt-4o-mini'

    if (
      cachedNotes &&
      cachedNotes.transcriptHash === transcriptHash &&
      cachedNotes.promptVersion === this.notes.generationService.getPromptVersion() &&
      cachedNotes.language === runtimeConfig.language &&
      cachedNotes.provider === runtimeConfig.provider &&
      cachedNotes.model === resolvedModel
    ) {
      return cachedNotes
    }

    const notes = await this.notes.generationService.generate({
      transcript,
      config: runtimeConfig
    })
    await this.notes.repository.saveNotes(notes)
    return notes
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
