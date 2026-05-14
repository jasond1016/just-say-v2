import type {
  ExportFormat,
  ExportResult,
  HistoryListQuery,
  HistorySearchQuery,
  PaginatedHistoryResult,
  SavedTranscript,
  TranscriptNotes
} from '../../shared/api-types'

export interface TranscriptRepository {
  save(transcript: SavedTranscript): Promise<void>
  list(query: HistoryListQuery): Promise<PaginatedHistoryResult>
  search(query: HistorySearchQuery): Promise<PaginatedHistoryResult>
  getById(id: string): Promise<SavedTranscript | null>
  delete(id: string): Promise<boolean>
}

export interface TranscriptNotesRepository {
  getNotesByTranscriptId(id: string): Promise<TranscriptNotes | null>
  saveNotes(notes: TranscriptNotes): Promise<void>
}

export interface TranscriptExporter {
  export(id: string, format: ExportFormat): Promise<ExportResult>
}
