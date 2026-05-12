import type {
  AppSettings,
  AppRuntimeSnapshot,
  DiagnosticBundleResult,
  EngineProfile,
  ExportFormat,
  ExportResult,
  HistoryListQuery,
  HistorySearchQuery,
  PaginatedHistoryResult,
  ProfileTestResult,
  SavedTranscript,
  StartMeetingCommand,
  SettingsPatch,
  RuntimeNotification,
  TranslationCredentialsInput
} from '../shared/api-types'
import type { SessionMode } from '../shared/primitive-types'
import { IPC_CHANNELS } from '../main/ipc/channels'

export type AppApi = {
  getRuntime: () => Promise<AppRuntimeSnapshot>
  onRuntimeSnapshot: (listener: (snapshot: AppRuntimeSnapshot) => void) => () => void
  onRuntimeNotification: (listener: (notification: RuntimeNotification) => void) => () => void
  getSettings: () => Promise<AppSettings>
  onSettingsChanged: (listener: (settings: AppSettings) => void) => () => void
  updateSettings: (patch: SettingsPatch) => Promise<AppSettings>
  saveTranslationCredentials: (input: TranslationCredentialsInput) => Promise<AppSettings>
  listSpeechProfiles: () => Promise<EngineProfile[]>
  testSpeechProfile: (profileId: string) => Promise<ProfileTestResult>
  prewarmSession: (mode: SessionMode) => Promise<void>
  startPtt: () => Promise<void>
  stopPtt: () => Promise<void>
  copyLatestPttText: () => Promise<void>
  startMeeting: (input?: StartMeetingCommand) => Promise<void>
  stopMeeting: () => Promise<void>
  copyLiveSession: () => Promise<void>
  exportLiveSession: (format: ExportFormat) => Promise<ExportResult>
  listHistory: (query?: HistoryListQuery) => Promise<PaginatedHistoryResult>
  searchHistory: (query: HistorySearchQuery) => Promise<PaginatedHistoryResult>
  getHistory: (id: string) => Promise<SavedTranscript | null>
  deleteHistory: (id: string) => Promise<boolean>
  copyHistory: (id: string, format: ExportFormat) => Promise<void>
  exportHistory: (id: string, format: ExportFormat) => Promise<ExportResult>
  exportDiagnostics: () => Promise<DiagnosticBundleResult>
}

export type IpcInvoke = <TResult>(channel: string, ...args: unknown[]) => Promise<TResult>
export type IpcEventSource = {
  on(channel: string, listener: (_event: unknown, payload: unknown) => void): void
  off(channel: string, listener: (_event: unknown, payload: unknown) => void): void
}

export function createAppApi(invoke: IpcInvoke, events?: IpcEventSource): AppApi {
  return {
    getRuntime: async () => invoke<AppRuntimeSnapshot>(IPC_CHANNELS.sessionGetRuntime),
    onRuntimeSnapshot(listener) {
      return subscribeToEvent(events, IPC_CHANNELS.runtimeSnapshot, (payload) => {
        listener(payload as AppRuntimeSnapshot)
      })
    },
    onRuntimeNotification(listener) {
      return subscribeToEvent(events, IPC_CHANNELS.runtimeNotification, (payload) => {
        listener(payload as RuntimeNotification)
      })
    },
    getSettings: async () => invoke<AppSettings>(IPC_CHANNELS.settingsGet),
    onSettingsChanged(listener) {
      return subscribeToEvent(events, IPC_CHANNELS.settingsChanged, (payload) => {
        listener(payload as AppSettings)
      })
    },
    updateSettings: async (patch) => invoke<AppSettings>(IPC_CHANNELS.settingsUpdate, patch),
    saveTranslationCredentials: async (input) =>
      invoke<AppSettings>(IPC_CHANNELS.settingsSaveTranslationCredentials, input),
    listSpeechProfiles: async () => invoke<EngineProfile[]>(IPC_CHANNELS.speechListProfiles),
    testSpeechProfile: async (profileId) =>
      invoke<ProfileTestResult>(IPC_CHANNELS.speechTestProfile, profileId),
    prewarmSession: async (mode) => invoke<void>(IPC_CHANNELS.sessionPrewarm, mode),
    startPtt: async () => invoke<void>(IPC_CHANNELS.sessionStartPtt),
    stopPtt: async () => invoke<void>(IPC_CHANNELS.sessionStopPtt),
    copyLatestPttText: async () => invoke<void>(IPC_CHANNELS.sessionCopyLatestPttText),
    startMeeting: async (input = {}) => invoke<void>(IPC_CHANNELS.sessionStartMeeting, input),
    stopMeeting: async () => invoke<void>(IPC_CHANNELS.sessionStopMeeting),
    copyLiveSession: async () => invoke<void>(IPC_CHANNELS.sessionCopyLiveSession),
    exportLiveSession: async (format) =>
      invoke<ExportResult>(IPC_CHANNELS.sessionExportLiveSession, format),
    listHistory: async (query = {}) =>
      invoke<PaginatedHistoryResult>(IPC_CHANNELS.historyList, query),
    searchHistory: async (query) =>
      invoke<PaginatedHistoryResult>(IPC_CHANNELS.historySearch, query),
    getHistory: async (id) => invoke<SavedTranscript | null>(IPC_CHANNELS.historyGet, id),
    deleteHistory: async (id) => invoke<boolean>(IPC_CHANNELS.historyDelete, id),
    copyHistory: async (id, format) => invoke<void>(IPC_CHANNELS.historyCopy, id, format),
    exportHistory: async (id, format) =>
      invoke<ExportResult>(IPC_CHANNELS.historyExport, id, format),
    exportDiagnostics: async () =>
      invoke<DiagnosticBundleResult>(IPC_CHANNELS.diagnosticsExport)
  }
}

function subscribeToEvent(
  events: IpcEventSource | undefined,
  channel: string,
  listener: (payload: unknown) => void
): () => void {
  if (!events) {
    return () => {}
  }

  const handler = (_event: unknown, payload: unknown) => {
    listener(payload)
  }

  events.on(channel, handler)

  return () => {
    events.off(channel, handler)
  }
}

export const api: AppApi = createAppApi(async () => {
  throw new Error('preload invoke is not implemented')
})
