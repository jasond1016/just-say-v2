import type {
  ExportFormat,
  ExportResult,
  HistoryListQuery,
  HistorySearchQuery,
  PaginatedHistoryResult,
  SavedTranscript
} from '../../shared/api-types'
import { IPC_CHANNELS } from './channels'

export type HistoryHandlerService = {
  list(query?: HistoryListQuery): Promise<PaginatedHistoryResult>
  search(query: HistorySearchQuery): Promise<PaginatedHistoryResult>
  get(id: string): Promise<SavedTranscript | null>
  delete(id: string): Promise<boolean>
  copy(id: string, format: ExportFormat): Promise<void>
  export(id: string, format: ExportFormat): Promise<ExportResult>
}

export type HistoryHandlers = {
  [IPC_CHANNELS.historyList]: (query?: HistoryListQuery) => Promise<PaginatedHistoryResult>
  [IPC_CHANNELS.historySearch]: (query: HistorySearchQuery) => Promise<PaginatedHistoryResult>
  [IPC_CHANNELS.historyGet]: (id: string) => Promise<SavedTranscript | null>
  [IPC_CHANNELS.historyDelete]: (id: string) => Promise<boolean>
  [IPC_CHANNELS.historyCopy]: (id: string, format: ExportFormat) => Promise<void>
  [IPC_CHANNELS.historyExport]: (id: string, format: ExportFormat) => Promise<ExportResult>
}

export function createHistoryHandlers(historyService: HistoryHandlerService): HistoryHandlers {
  return {
    [IPC_CHANNELS.historyList]: async (query = {}) => historyService.list(query),
    [IPC_CHANNELS.historySearch]: async (query) => historyService.search(query),
    [IPC_CHANNELS.historyGet]: async (id) => historyService.get(id),
    [IPC_CHANNELS.historyDelete]: async (id) => historyService.delete(id),
    [IPC_CHANNELS.historyCopy]: async (id, format) => historyService.copy(id, format),
    [IPC_CHANNELS.historyExport]: async (id, format) => historyService.export(id, format)
  }
}
