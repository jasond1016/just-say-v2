import type {
  AppRuntimeSnapshot,
  AppSettings,
  EngineProfile,
  ExportFormat,
  OutputMethod,
  PaginatedHistoryResult,
  PttHotkey,
  ProfileTestResult,
  RuntimeNotification,
  SavedTranscript,
  SpeechLanguage,
  ThemeSetting,
  TranslationProvider
} from '../../shared/api-types'
import type { CaptureSource } from '../../shared/primitive-types'
import { createDefaultSettings } from '../../core/settings/settings-schema'
import type { AppApi } from '../../preload/api'
import type { AppSection } from './app-model'
import { getPreferredSection } from './app-model'

type RuntimeStoreLike = {
  getSnapshot(): AppRuntimeSnapshot
  refresh(api: AppApi): Promise<AppRuntimeSnapshot>
  connect(listener: (snapshot: AppRuntimeSnapshot) => void, api: AppApi): () => void
}

export type HistoryModeFilter = 'all' | SavedTranscript['mode']
export type HistorySourceFilter = 'all' | CaptureSource
export type HistoryTimeFilter = 'all' | 'today' | 'last_7_days' | 'last_30_days'

export type AppControllerState = {
  runtime: AppRuntimeSnapshot
  settings: AppSettings
  profiles: EngineProfile[]
  profileTests: Record<string, ProfileTestResult | undefined>
  history: SavedTranscript[]
  historyTotal: number
  selectedHistory: SavedTranscript | null
  exportMessage: string | null
  liveSessionMessage: string | null
  diagnosticsMessage: string | null
  activeSection: AppSection
  historyQuery: string
  historyMode: HistoryModeFilter
  historySource: HistorySourceFilter
  historyTimeFilter: HistoryTimeFilter
  latestNotification: RuntimeNotification | null
  error: string | null
  busyAction: string | null
}

export function createInitialAppControllerState(): AppControllerState {
  return {
    runtime: {
      ptt: {
        status: 'idle'
      },
      liveSession: null,
      services: {
        localService: 'stopped'
      }
    },
    settings: createDefaultSettings(),
    profiles: [],
    profileTests: {},
    history: [],
    historyTotal: 0,
    selectedHistory: null,
    exportMessage: null,
    liveSessionMessage: null,
    diagnosticsMessage: null,
    activeSection: 'quick-dictation',
    historyQuery: '',
    historyMode: 'all',
    historySource: 'all',
    historyTimeFilter: 'all',
    latestNotification: null,
    error: null,
    busyAction: null
  }
}

export class AppController {
  private state = createInitialAppControllerState()
  private readonly listeners = new Set<() => void>()
  private disconnectors: Array<() => void> = []
  private started = false
  private disposed = false
  private historyRequestId = 0
  private lifecycleToken = 0
  private readonly now: () => number

  constructor(
    private readonly deps: {
      api: AppApi
      runtimeStore: RuntimeStoreLike
      now?: () => number
    }
  ) {
    this.now = deps.now ?? Date.now
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)

    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot = (): AppControllerState => this.state

  start(): () => void {
    if (this.started) {
      return this.stop
    }

    this.started = true
    this.disposed = false
    const lifecycleToken = ++this.lifecycleToken

    this.disconnectors = [
      this.deps.runtimeStore.connect((snapshot) => {
        this.setState((current) => ({
          ...current,
          runtime: snapshot,
          ...(snapshot.liveSession && current.activeSection === 'quick-dictation'
            ? { activeSection: 'live-session' as const }
            : {})
        }))
      }, this.deps.api),
      this.deps.api.onRuntimeNotification((notification) => {
        this.setState({
          latestNotification: notification
        })
      }),
      this.deps.api.onSettingsChanged((settings) => {
        this.setState({
          settings
        })
      })
    ]

    void this.bootstrap(lifecycleToken)

    return this.stop
  }

  setActiveSection(section: AppSection): void {
    this.setState({
      activeSection: section
    })
  }

  openLiveSessionSection(): void {
    this.setActiveSection('live-session')
  }

  openHistorySection(): void {
    this.setActiveSection('history')
  }

  async setHistoryQuery(query: string): Promise<void> {
    this.setState({
      historyQuery: query
    })
    await this.refreshHistory()
  }

  async setHistoryMode(mode: HistoryModeFilter): Promise<void> {
    this.setState({
      historyMode: mode
    })
    await this.refreshHistory()
  }

  async setHistorySource(source: HistorySourceFilter): Promise<void> {
    this.setState({
      historySource: source
    })
    await this.refreshHistory()
  }

  async setHistoryTimeFilter(timeFilter: HistoryTimeFilter): Promise<void> {
    this.setState({
      historyTimeFilter: timeFilter
    })
    await this.refreshHistory()
  }

  async refresh(): Promise<void> {
    await this.runAction('refresh', async () => {
      await this.refreshAll()
    })
  }

  async startPtt(): Promise<void> {
    await this.runAction('ptt-start', async () => {
      await this.deps.api.startPtt()
      await this.refreshRuntimeOnly()
    })
  }

  async stopPtt(): Promise<void> {
    await this.runAction('ptt-stop', async () => {
      await this.deps.api.stopPtt()
      await this.refreshAll()
    })
  }

  async copyLatestPttText(): Promise<void> {
    await this.runAction('ptt-copy-latest', async () => {
      await this.deps.api.copyLatestPttText()
      await this.refreshRuntimeOnly()
    })
  }

  async startMeeting(): Promise<void> {
    const settings = this.state.settings

    await this.runAction('meeting-start', async () => {
      await this.deps.api.startMeeting({
        includeMicrophone: settings.input.includeMicrophoneInMeeting,
        translationEnabled: settings.translation.enabledForMeeting,
        ...(settings.translation.enabledForMeeting
          ? { targetLanguage: settings.translation.targetLanguage }
          : {})
      })
      await this.refreshRuntimeOnly()
    })
  }

  async stopMeeting(): Promise<void> {
    await this.runAction('meeting-stop', async () => {
      await this.deps.api.stopMeeting()
      await this.refreshAll()
    })
  }

  async copyLiveSession(): Promise<void> {
    await this.runAction('live-session-copy', async () => {
      await this.deps.api.copyLiveSession()
      this.setState({
        liveSessionMessage: 'Copied the live session transcript to the clipboard.'
      })
    })
  }

  async exportLiveSession(format: ExportFormat): Promise<void> {
    await this.runAction(`live-session-export:${format}`, async () => {
      const result = await this.deps.api.exportLiveSession(format)
      this.setState({
        liveSessionMessage: result.ok ? `Exported live session to ${result.path}` : result.error ?? 'Live session export failed'
      })
    })
  }

  async openHistoryItem(id: string): Promise<void> {
    await this.runAction(`open:${id}`, async () => {
      const transcript = await this.deps.api.getHistory(id)
      this.setState({
        selectedHistory: transcript
      })
    })
  }

  async deleteHistoryItem(id: string): Promise<void> {
    await this.runAction(`delete:${id}`, async () => {
      await this.deps.api.deleteHistory(id)

      if (this.state.selectedHistory?.id === id) {
        this.setState({
          selectedHistory: null
        })
      }

      await this.refreshAll()
    })
  }

  async copyHistoryItem(id: string, format: ExportFormat): Promise<void> {
    await this.runAction(`copy:${id}:${format}`, async () => {
      await this.deps.api.copyHistory(id, format)
      this.setState({
        exportMessage:
          format === 'bilingual_text'
            ? 'Copied bilingual transcript to the clipboard.'
            : format === 'json'
              ? 'Copied transcript JSON to the clipboard.'
              : 'Copied transcript text to the clipboard.'
      })
    })
  }

  async exportHistoryItem(id: string, format: ExportFormat): Promise<void> {
    await this.runAction(`export:${id}:${format}`, async () => {
      const result = await this.deps.api.exportHistory(id, format)
      this.setState({
        exportMessage: result.ok ? `Exported to ${result.path}` : result.error ?? 'Export failed'
      })
    })
  }

  async setGeneralLanguage(language: AppSettings['general']['language']): Promise<void> {
    await this.updateSettings('settings:general-language', {
      general: {
        language
      }
    })
  }

  async setTheme(theme: ThemeSetting): Promise<void> {
    await this.updateSettings('settings:theme', {
      general: {
        theme
      }
    })
  }

  async setMinimizeToTray(minimizeToTray: boolean): Promise<void> {
    await this.updateSettings('settings:minimize-to-tray', {
      general: {
        minimizeToTray
      }
    })
  }

  async selectProfile(profileId: string): Promise<void> {
    await this.updateSettings(`profile-select:${profileId}`, {
      speech: {
        selectedProfileId: profileId
      }
    })
  }

  async setSpeechLanguage(language: SpeechLanguage): Promise<void> {
    await this.updateSettings('settings:speech-language', {
      speech: {
        language
      }
    })
  }

  async setPttHotkey(pttHotkey: PttHotkey): Promise<void> {
    await this.updateSettings('settings:ptt-hotkey', {
      input: {
        pttHotkey
      }
    })
  }

  async setIncludeMicrophoneInMeeting(includeMicrophoneInMeeting: boolean): Promise<void> {
    await this.updateSettings('settings:meeting-microphone', {
      input: {
        includeMicrophoneInMeeting
      }
    })
  }

  async setOutputMethod(method: OutputMethod): Promise<void> {
    await this.updateSettings('settings:output-method', {
      output: {
        method
      }
    })
  }

  async setTranslationEnabledForPtt(enabledForPtt: boolean): Promise<void> {
    await this.updateSettings('settings:translation-ptt', {
      translation: {
        enabledForPtt
      }
    })
  }

  async setTranslationEnabledForMeeting(enabledForMeeting: boolean): Promise<void> {
    await this.updateSettings('settings:translation-meeting', {
      translation: {
        enabledForMeeting
      }
    })
  }

  async setTranslationTargetLanguage(targetLanguage: string): Promise<void> {
    await this.updateSettings('settings:translation-target', {
      translation: {
        targetLanguage
      }
    })
  }

  async setTranslationProvider(provider: TranslationProvider): Promise<void> {
    await this.updateSettings('settings:translation-provider', {
      translation: {
        provider
      }
    })
  }

  async setLocalServiceHost(localServiceHost: string): Promise<void> {
    await this.updateSettings('settings:local-service-host', {
      advanced: {
        localServiceHost
      }
    })
  }

  async setLocalServicePort(localServicePort: number | undefined): Promise<void> {
    await this.updateSettings('settings:local-service-port', {
      advanced:
        localServicePort === undefined
          ? {}
          : {
              localServicePort
            }
    })
  }

  async testProfile(profileId: string): Promise<void> {
    await this.runAction(`profile-test:${profileId}`, async () => {
      const result = await this.deps.api.testSpeechProfile(profileId)
      this.setState((current) => ({
        ...current,
        profileTests: {
          ...current.profileTests,
          [profileId]: result
        }
      }))
      await this.refreshRuntimeOnly()
    })
  }

  async exportDiagnostics(): Promise<void> {
    await this.runAction('diagnostics-export', async () => {
      const result = await this.deps.api.exportDiagnostics()
      this.setState({
        diagnosticsMessage: result.ok ? `Diagnostics exported to ${result.path}` : result.error ?? 'Diagnostics export failed'
      })
    })
  }

  private async updateSettings(label: string, patch: Parameters<AppApi['updateSettings']>[0]): Promise<void> {
    await this.runAction(label, async () => {
      const updated = await this.deps.api.updateSettings(patch)

      this.setState({
        settings: updated
      })
    })
  }

  private readonly stop = (): void => {
    if (!this.started) {
      return
    }

    this.started = false
    this.disposed = true
    this.lifecycleToken += 1
    this.historyRequestId += 1

    for (const disconnect of this.disconnectors.splice(0)) {
      disconnect()
    }
  }

  private async bootstrap(lifecycleToken: number): Promise<void> {
    try {
      await this.refreshAll(lifecycleToken)

      if (!this.isLifecycleCurrent(lifecycleToken)) {
        return
      }

      this.setState((current) => ({
        ...current,
        activeSection:
          current.activeSection === 'quick-dictation'
            ? getPreferredSection(this.deps.runtimeStore.getSnapshot())
            : current.activeSection
      }))
    } catch (error) {
      if (!this.isLifecycleCurrent(lifecycleToken)) {
        return
      }

      this.setState({
        error: describeError(error, 'Unknown bootstrap error')
      })
    }
  }

  private async refreshAll(lifecycleToken: number = this.lifecycleToken): Promise<void> {
    const [runtimeSnapshot, appSettings, speechProfiles] = await Promise.all([
      this.deps.runtimeStore.refresh(this.deps.api),
      this.deps.api.getSettings(),
      this.deps.api.listSpeechProfiles()
    ])

    if (!this.isLifecycleCurrent(lifecycleToken)) {
      return
    }

    this.setState({
      runtime: runtimeSnapshot,
      settings: appSettings,
      profiles: speechProfiles
    })

    await this.refreshHistory(lifecycleToken)
  }

  private async refreshRuntimeOnly(lifecycleToken: number = this.lifecycleToken): Promise<void> {
    const runtimeSnapshot = await this.deps.runtimeStore.refresh(this.deps.api)

    if (!this.isLifecycleCurrent(lifecycleToken)) {
      return
    }

    this.setState({
      runtime: runtimeSnapshot
    })
  }

  private async refreshHistory(lifecycleToken: number = this.lifecycleToken): Promise<void> {
    const requestId = ++this.historyRequestId
    const historyQuery = this.state.historyQuery
    const historyMode = this.state.historyMode
    const historySource = this.state.historySource
    const historyTimeFilter = this.state.historyTimeFilter
    const selectedHistory = this.state.selectedHistory

    try {
      const historyPage = await loadHistoryPage(
        this.deps.api,
        historyQuery,
        historyMode,
        historySource,
        historyTimeFilter,
        this.now()
      )

      if (!this.isLifecycleCurrent(lifecycleToken) || requestId !== this.historyRequestId) {
        return
      }

      const nextSelectedHistory = await this.resolveSelectedHistory(selectedHistory, historyPage)

      if (!this.isLifecycleCurrent(lifecycleToken) || requestId !== this.historyRequestId) {
        return
      }

      this.setState({
        history: historyPage.items,
        historyTotal: historyPage.total,
        selectedHistory: nextSelectedHistory
      })
    } catch (error) {
      if (!this.isLifecycleCurrent(lifecycleToken) || requestId !== this.historyRequestId) {
        return
      }

      this.setState({
        error: describeError(error, 'Unknown history error')
      })
    }
  }

  private isLifecycleCurrent(lifecycleToken: number): boolean {
    return !this.disposed && lifecycleToken === this.lifecycleToken
  }

  private async resolveSelectedHistory(
    selectedHistory: SavedTranscript | null,
    historyPage: PaginatedHistoryResult
  ): Promise<SavedTranscript | null> {
    if (!selectedHistory) {
      return null
    }

    const freshSelection = historyPage.items.find((item) => item.id === selectedHistory.id)

    if (!freshSelection) {
      return null
    }

    return this.deps.api.getHistory(selectedHistory.id)
  }

  private async runAction(label: string, action: () => Promise<void>): Promise<void> {
    this.setState({
      busyAction: label,
      error: null,
      exportMessage: null,
      liveSessionMessage: null
    })

    try {
      await action()
    } catch (error) {
      if (this.disposed) {
        return
      }

      this.setState({
        error: describeError(error, 'Unknown action error')
      })
    } finally {
      if (this.disposed) {
        return
      }

      this.setState({
        busyAction: null
      })
    }
  }

  private setState(
    nextState:
      | Partial<AppControllerState>
      | ((current: AppControllerState) => AppControllerState)
  ): void {
    if (this.disposed) {
      return
    }

    this.state =
      typeof nextState === 'function'
        ? nextState(this.state)
        : {
            ...this.state,
            ...nextState
          }

    this.emit()
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener()
    }
  }
}

function describeError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

async function loadHistoryPage(
  api: AppApi,
  query: string,
  mode: HistoryModeFilter,
  source: HistorySourceFilter,
  timeFilter: HistoryTimeFilter,
  now: number
): Promise<PaginatedHistoryResult> {
  const normalizedMode = mode === 'all' ? undefined : mode
  const normalizedSource = source === 'all' ? undefined : source
  const startedAfter = resolveStartedAfter(timeFilter, now)
  const keyword = query.trim()

  if (!keyword) {
    return api.listHistory({
      ...(normalizedMode ? { mode: normalizedMode } : {}),
      ...(normalizedSource ? { source: normalizedSource } : {}),
      ...(startedAfter !== undefined ? { startedAfter } : {})
    })
  }

  return api.searchHistory({
    query: keyword,
    ...(normalizedMode ? { mode: normalizedMode } : {}),
    ...(normalizedSource ? { source: normalizedSource } : {}),
    ...(startedAfter !== undefined ? { startedAfter } : {})
  })
}

function resolveStartedAfter(timeFilter: HistoryTimeFilter, now: number): number | undefined {
  const current = new Date(now)

  switch (timeFilter) {
    case 'today':
      return new Date(current.getFullYear(), current.getMonth(), current.getDate()).getTime()
    case 'last_7_days':
      return now - 7 * 24 * 60 * 60 * 1000
    case 'last_30_days':
      return now - 30 * 24 * 60 * 60 * 1000
    case 'all':
    default:
      return undefined
  }
}
