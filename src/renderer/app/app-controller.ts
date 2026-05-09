import type {
  AppRuntimeSnapshot,
  AppSettings,
  EngineProfile,
  ExportFormat,
  PaginatedHistoryResult,
  ProfileTestResult,
  RuntimeNotification,
  SavedTranscript
} from '../../shared/api-types'
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

export type AppControllerState = {
  runtime: AppRuntimeSnapshot
  settings: AppSettings
  profiles: EngineProfile[]
  profileTests: Record<string, ProfileTestResult | undefined>
  history: SavedTranscript[]
  historyTotal: number
  selectedHistory: SavedTranscript | null
  exportMessage: string | null
  diagnosticsMessage: string | null
  activeSection: AppSection
  historyQuery: string
  historyMode: HistoryModeFilter
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
    diagnosticsMessage: null,
    activeSection: 'quick-dictation',
    historyQuery: '',
    historyMode: 'all',
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

  constructor(
    private readonly deps: {
      api: AppApi
      runtimeStore: RuntimeStoreLike
    }
  ) {}

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

  async exportHistoryItem(id: string, format: ExportFormat): Promise<void> {
    await this.runAction(`export:${id}:${format}`, async () => {
      const result = await this.deps.api.exportHistory(id, format)
      this.setState({
        exportMessage: result.ok ? `Exported to ${result.path}` : result.error ?? 'Export failed'
      })
    })
  }

  async toggleTheme(): Promise<void> {
    const nextTheme = this.state.settings.general.theme === 'light' ? 'dark' : 'light'

    await this.runAction('theme', async () => {
      const updated = await this.deps.api.updateSettings({
        general: {
          theme: nextTheme
        }
      })

      this.setState({
        settings: updated
      })
    })
  }

  async selectProfile(profileId: string): Promise<void> {
    await this.runAction(`profile-select:${profileId}`, async () => {
      const updated = await this.deps.api.updateSettings({
        speech: {
          selectedProfileId: profileId
        }
      })

      this.setState({
        settings: updated
      })
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
    const selectedHistory = this.state.selectedHistory

    try {
      const historyPage = await loadHistoryPage(this.deps.api, historyQuery, historyMode)

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
      exportMessage: null
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
  mode: HistoryModeFilter
): Promise<PaginatedHistoryResult> {
  const normalizedMode = mode === 'all' ? undefined : mode
  const keyword = query.trim()

  if (!keyword) {
    return api.listHistory(normalizedMode ? { mode: normalizedMode } : {})
  }

  return api.searchHistory({
    query: keyword,
    ...(normalizedMode ? { mode: normalizedMode } : {})
  })
}
