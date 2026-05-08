import type {
  ExportFormat,
  ExportResult,
  HistoryListQuery,
  HistorySearchQuery,
  PaginatedHistoryResult,
  SavedTranscript
} from '../../shared/api-types'
import type { TranscriptExporter, TranscriptRepository } from '../../core/contracts/storage'

export class HistoryService {
  constructor(
    private readonly repository: TranscriptRepository,
    private readonly exporter?: TranscriptExporter
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
    return this.repository.delete(id)
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
}
