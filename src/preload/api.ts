import type {
  AppSettings,
  AppRuntimeSnapshot,
  ExportFormat,
  ExportResult,
  HistoryListQuery,
  HistorySearchQuery,
  PaginatedHistoryResult,
  SavedTranscript,
  StartMeetingCommand,
  SettingsPatch
} from '../shared/api-types'
import type { SessionMode } from '../shared/primitive-types'
import { IPC_CHANNELS } from '../main/ipc/channels'

export type AppApi = {
  getRuntime: () => Promise<AppRuntimeSnapshot>
  getSettings: () => Promise<AppSettings>
  updateSettings: (patch: SettingsPatch) => Promise<AppSettings>
  prewarmSession: (mode: SessionMode) => Promise<void>
  startPtt: () => Promise<void>
  stopPtt: () => Promise<void>
  startMeeting: (input?: StartMeetingCommand) => Promise<void>
  stopMeeting: () => Promise<void>
  listHistory: (query?: HistoryListQuery) => Promise<PaginatedHistoryResult>
  searchHistory: (query: HistorySearchQuery) => Promise<PaginatedHistoryResult>
  getHistory: (id: string) => Promise<SavedTranscript | null>
  deleteHistory: (id: string) => Promise<boolean>
  exportHistory: (id: string, format: ExportFormat) => Promise<ExportResult>
}

export type IpcInvoke = <TResult>(channel: string, ...args: unknown[]) => Promise<TResult>

export function createAppApi(invoke: IpcInvoke): AppApi {
  return {
    getRuntime: async () => invoke<AppRuntimeSnapshot>(IPC_CHANNELS.sessionGetRuntime),
    getSettings: async () => invoke<AppSettings>(IPC_CHANNELS.settingsGet),
    updateSettings: async (patch) => invoke<AppSettings>(IPC_CHANNELS.settingsUpdate, patch),
    prewarmSession: async (mode) => invoke<void>(IPC_CHANNELS.sessionPrewarm, mode),
    startPtt: async () => invoke<void>(IPC_CHANNELS.sessionStartPtt),
    stopPtt: async () => invoke<void>(IPC_CHANNELS.sessionStopPtt),
    startMeeting: async (input = {}) => invoke<void>(IPC_CHANNELS.sessionStartMeeting, input),
    stopMeeting: async () => invoke<void>(IPC_CHANNELS.sessionStopMeeting),
    listHistory: async (query = {}) =>
      invoke<PaginatedHistoryResult>(IPC_CHANNELS.historyList, query),
    searchHistory: async (query) =>
      invoke<PaginatedHistoryResult>(IPC_CHANNELS.historySearch, query),
    getHistory: async (id) => invoke<SavedTranscript | null>(IPC_CHANNELS.historyGet, id),
    deleteHistory: async (id) => invoke<boolean>(IPC_CHANNELS.historyDelete, id),
    exportHistory: async (id, format) =>
      invoke<ExportResult>(IPC_CHANNELS.historyExport, id, format)
  }
}

export const api: AppApi = createAppApi(async () => {
  throw new Error('preload invoke is not implemented')
})
