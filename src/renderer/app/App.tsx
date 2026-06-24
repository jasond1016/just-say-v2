import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'

import { createBrowserCaptureSourceManager } from '../capture/browser-capture-source'
import { CaptureRuntime } from '../capture/capture-runtime'
import { RuntimeStore } from '../features/runtime/runtime-store'
import { NotificationStore } from '../features/notifications/notification-store'
import { ToastContainer, BannerContainer } from '../features/notifications/NotificationUI'
import { I18nProvider, useT } from '../i18n-context'
import { HistoryPage } from '../pages/history-page'
import { LiveSessionPage } from '../pages/live-session-page'
import { QuickDictationPage } from '../pages/quick-dictation-page'
import { SettingsPage } from '../pages/settings-page'
import { describeLocalServiceStatus } from '../ui/copy'
import type { AppRuntimeSnapshot, LocalServiceStatus, PttHudSnapshot, ThemeSetting } from '../../shared/api-types'
import type { AppLocale } from '../../i18n'
import { APP_SECTIONS } from './app-model'
import { AppController } from './app-controller'

type RetainedLiveSession = NonNullable<AppRuntimeSnapshot['liveSession']>

export function App() {
  if (window.location.hash === '#hud') {
    return <PttHudWindowApp />
  }

  if (window.location.hash === '#capture') {
    return <CaptureWindowApp />
  }

  return <WorkspaceApp />
}

function WorkspaceApp() {
  const notificationStore = useMemo(() => new NotificationStore(), [])
  const controller = useMemo(() => {
    return new AppController({
      api: requireApi(),
      runtimeStore: new RuntimeStore()
    })
  }, [])
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  const locale = state.settings.general.language as AppLocale

  return (
    <I18nProvider locale={locale}>
      <WorkspaceAppContent controller={controller} state={state} notificationStore={notificationStore} />
    </I18nProvider>
  )
}

function WorkspaceAppContent(props: {
  controller: AppController
  state: ReturnType<AppController['getSnapshot']>
  notificationStore: NotificationStore
}) {
  const { controller, notificationStore } = props
  const {
    runtime,
    settings,
    profiles,
    profileTests,
    history,
    historyTotal,
    recentPttDictations,
    recentMeetingSessions,
    selectedHistory,
    selectedHistoryAudio,
    selectedHistoryNotes,
    selectedHistoryNotesStatus,
    selectedHistoryNotesError,
    exportMessage,
    liveSessionMessage,
    diagnosticsMessage,
    activeSection,
    settingsSection,
    historyQuery,
    historyMode,
    historySource,
    historyTimeFilter,
    error,
    busyAction
  } = props.state
  const [retainedLiveSession, setRetainedLiveSession] = useState<RetainedLiveSession | null>(null)

  useEffect(() => {
    applyThemeSetting(settings.general.theme)
  }, [settings.general.theme])

  useEffect(() => {
    const stopController = controller.start()
    const unsubNotification = requireApi().onRuntimeNotification((notification) => {
      notificationStore.push(notification)
    })
    return () => {
      stopController()
      unsubNotification()
    }
  }, [controller, notificationStore])

  useEffect(() => {
    if (!runtime.liveSession) {
      return
    }

    setRetainedLiveSession(cloneLiveSession(runtime.liveSession))
  }, [runtime.liveSession])

  const liveSession = runtime.liveSession
  const displayLiveSession = liveSession ?? retainedLiveSession
  const meetingActive = Boolean(liveSession)
  const pttStartDisabled = Boolean(busyAction) || runtime.ptt.status !== 'idle'
  const pttStopDisabled = Boolean(busyAction) || runtime.ptt.status !== 'capturing'
  const meetingStartDisabled = Boolean(busyAction) || meetingActive
  const meetingStopDisabled = Boolean(busyAction) || !liveSession || liveSession.status !== 'streaming'
  const serviceStatus = runtime.services.localService
  const serviceLabel = describeLocalServiceStatus(serviceStatus)
  const t = useT()

  return (
    <div className="app-shell">
      <div className="app-titlebar-drag" aria-hidden="true" />
      <nav className="app-sidebar" aria-label="Workspace sections">
        <div className="app-sidebar__brand">
          <svg className="app-sidebar__brand-icon" width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path d="M10 1a3.5 3.5 0 0 0-3.5 3.5v5a3.5 3.5 0 1 0 7 0v-5A3.5 3.5 0 0 0 10 1Z" fill="currentColor" />
            <path d="M5 8.5a.75.75 0 0 0-1.5 0v1a6.5 6.5 0 0 0 5.75 6.46v2.29a.75.75 0 0 0 1.5 0v-2.29A6.5 6.5 0 0 0 16.5 9.5v-1a.75.75 0 0 0-1.5 0v1a5 5 0 0 1-10 0v-1Z" fill="currentColor" />
          </svg>
          <div className="app-sidebar__brand-mark">JustSay</div>
        </div>

        <div className="app-sidebar__nav">
          {APP_SECTIONS.map((section) => {
            const isActive = activeSection === section.id
            return (
              <button
                key={section.id}
                type="button"
                data-active={isActive ? '' : undefined}
                onClick={() => controller.setActiveSection(section.id)}
                className="app-nav-button"
                aria-current={isActive ? 'page' : undefined}
              >
                <NavIcon name={section.icon} />
                <span>{t[section.labelKey]}</span>
              </button>
            )
          })}
        </div>

        <div className="app-sidebar__spacer" />

        <div className="app-sidebar__utility">
          {serviceStatus !== 'healthy' && serviceStatus !== 'starting' ? (
            <div className={`app-sidebar__status-expand ${serviceStatus === 'failed' || serviceStatus === 'stopped' ? 'app-sidebar__status-expand--failed' : ''}`}>
              <div className="app-sidebar__status-expand__head">
                <span className="app-sidebar__status-expand__head-dot" />
                {serviceLabel}
              </div>
              <div className="app-sidebar__status-expand__body">
                {describeDegradedGuidance(serviceStatus)}
              </div>
              <button
                type="button"
                className="app-sidebar__status-expand__action"
                disabled={Boolean(busyAction)}
                onClick={() => { void controller.restartLocalService() }}
              >
                {busyAction === 'local-service-restart' ? 'Restarting...' : 'Restart service'}
              </button>
            </div>
          ) : (
            <div
              className={`app-sidebar__status app-sidebar__status--${serviceStatusClass(serviceStatus)}`}
              role="status"
              aria-live="polite"
            >
              <span className="app-sidebar__status-dot" />
              {serviceLabel}
            </div>
          )}

        </div>
      </nav>

      <main className={`app-main ${activeSection === 'live-session' ? 'app-main--session' : ''}`}>
        {error ? (
          <div className="app-main__notes">
            <div className="app-note app-note--error" role="alert">
              <strong>Action needed</strong>
              <span>{error}</span>
            </div>
          </div>
        ) : null}

        {(activeSection === 'quick-dictation' || activeSection === 'live-session') ? (
          <BannerContainer store={notificationStore} />
        ) : null}

        {activeSection === 'quick-dictation' ? (
          <QuickDictationPage
            runtime={runtime}
            settings={settings}
            localServiceStatus={serviceStatus}
            recentDictations={recentPttDictations}
            onCopyText={(id) => { void controller.copyHistoryItem(id, 'plain_text') }}
            onDeleteText={(id) => { void controller.deleteHistoryItem(id) }}
            onOpenHistory={() => { controller.openHistorySection() }}
            onOpenShortcutSettings={() => { controller.openSettingsSection('shortcuts') }}
          />
        ) : null}

        {activeSection === 'live-session' ? (
          <LiveSessionPage
            liveSession={displayLiveSession}
            activeRuntimeSession={liveSession}
            settings={settings}
            busyAction={busyAction}
            liveSessionMessage={liveSessionMessage}
            meetingStartDisabled={meetingStartDisabled}
            meetingStopDisabled={meetingStopDisabled}
            recentSessions={recentMeetingSessions}
            onStartMeeting={() => { void controller.startMeeting() }}
            onStopMeeting={() => { void controller.stopMeeting() }}
            onCopyLiveSession={() => { void controller.copyLiveSession() }}
            onExportLiveSession={(format) => { void controller.exportLiveSession(format) }}
            onOpenHistory={() => { controller.openHistorySection() }}
            onOpenHistoryItem={(id) => { void controller.openHistoryItemInArchive(id) }}
          />
        ) : null}

        {activeSection === 'history' ? (
          <HistoryPage
            items={history}
            total={historyTotal}
            searchQuery={historyQuery}
            selectedMode={historyMode}
            selectedSource={historySource}
            selectedTimeFilter={historyTimeFilter}
            selectedTranscript={selectedHistory}
            selectedAudio={selectedHistoryAudio}
            notesState={
              selectedHistoryNotesStatus === 'ready' && selectedHistoryNotes
                ? { status: 'ready', notes: selectedHistoryNotes }
                : selectedHistoryNotesStatus === 'failed'
                  ? { status: 'failed', message: selectedHistoryNotesError ?? 'Notes could not be loaded.' }
                  : selectedHistoryNotesStatus === 'loading'
                    ? { status: 'loading' }
                    : selectedHistoryNotesStatus === 'generating'
                      ? { status: 'generating' }
                      : { status: 'idle' }
            }
            exportMessage={exportMessage}
            busyAction={busyAction}
            onOpenQuickDictation={() => { controller.setActiveSection('quick-dictation') }}
            onOpenLiveSession={() => { controller.openLiveSessionSection() }}
            onSearchQueryChange={(query) => { void controller.setHistoryQuery(query) }}
            onModeChange={(mode) => { void controller.setHistoryMode(mode) }}
            onSourceChange={(source) => { void controller.setHistorySource(source) }}
            onTimeFilterChange={(timeFilter) => { void controller.setHistoryTimeFilter(timeFilter) }}
            onOpen={(id) => { void controller.openHistoryItem(id) }}
            onCloseDetail={() => { controller.clearSelectedHistory() }}
            onDelete={(id) => { void controller.deleteHistoryItem(id) }}
            onRenameTitle={(id, title) => { void controller.updateHistoryTitle(id, title) }}
            onDeleteBulk={(ids) => controller.deleteHistoryItems(ids)}
            onCopy={(id, format) => { void controller.copyHistoryItem(id, format) }}
            onExport={(id, format) => { void controller.exportHistoryItem(id, format) }}
            onGenerateNotes={(id, options) => { void controller.generateHistoryNotes(id, options) }}
          />
        ) : null}

        {activeSection === 'settings' ? (
          <SettingsPage
            initialSection={settingsSection}
            settings={settings}
            profiles={profiles}
            profileTests={profileTests}
            diagnosticsMessage={diagnosticsMessage}
            busyAction={busyAction}
            localServiceStatus={serviceStatus}
            onGeneralLanguageChange={(language) => { void controller.setGeneralLanguage(language) }}
            onThemeChange={(theme) => { void controller.setTheme(theme) }}
            onMinimizeToTrayChange={(minimizeToTray) => { void controller.setMinimizeToTray(minimizeToTray) }}
            onSelectProfile={(profileId) => { void controller.selectProfile(profileId) }}
            onTestProfile={(profileId) => { void controller.testProfile(profileId) }}
            onSpeechLanguageChange={(language) => { void controller.setSpeechLanguage(language) }}
            onPttHotkeyChange={(hotkey) => { void controller.setPttHotkey(hotkey) }}
            onOutputMethodChange={(method) => { void controller.setOutputMethod(method) }}
            onIncludeMicrophoneChange={(enabled) => { void controller.setIncludeMicrophoneInMeeting(enabled) }}
            onTranslatePttChange={(enabled) => { void controller.setTranslationEnabledForPtt(enabled) }}
            onTranslateMeetingChange={(enabled) => { void controller.setTranslationEnabledForMeeting(enabled) }}
            onTranslationTargetLanguageChange={(targetLanguage) => { void controller.setTranslationTargetLanguage(targetLanguage) }}
            onTranslationProviderChange={(provider) => { void controller.setTranslationProvider(provider) }}
            onTranslationEndpointChange={(endpoint) => { void controller.setTranslationEndpoint(endpoint) }}
            onTranslationModelChange={(model) => { void controller.setTranslationModel(model) }}
            onSaveTranslationApiKey={(apiKey) => controller.saveTranslationCredentials(apiKey)}
            onLocalServiceModeChange={(mode) => { void controller.setLocalServiceMode(mode) }}
            onLocalServiceHostChange={(host) => { void controller.setLocalServiceHost(host) }}
            onLocalServicePortChange={(port) => { void controller.setLocalServicePort(port) }}
            onRemoteServiceHostChange={(host) => { void controller.setRemoteServiceHost(host) }}
            onRemoteServicePortChange={(port) => { void controller.setRemoteServicePort(port) }}
            onExportDiagnostics={() => { void controller.exportDiagnostics() }}
          />
        ) : null}

        <ToastContainer store={notificationStore} />
      </main>
    </div>
  )
}

// Module-level singleton to prevent React StrictMode double-initialization
let activeCaptureRuntime: CaptureRuntime | null = null

function CaptureWindowApp() {
  useEffect(() => {
    if (!window.justSayCapture) return

    // Dispose any existing runtime (handles StrictMode remount)
    if (activeCaptureRuntime) {
      activeCaptureRuntime.dispose()
      activeCaptureRuntime = null
    }

    const captureRuntime = new CaptureRuntime(window.justSayCapture, createBrowserCaptureSourceManager())
    activeCaptureRuntime = captureRuntime
    captureRuntime.start()
    return () => {
      captureRuntime.dispose()
      if (activeCaptureRuntime === captureRuntime) {
        activeCaptureRuntime = null
      }
    }
  }, [])

  return (
    <main className="capture-shell">
      <div className="capture-card">
        <div className="capture-card__eyebrow">Capture Window</div>
        <h1 className="capture-card__title">Capture runtime ready</h1>
        <p className="capture-card__body">
          Hidden capture surface is subscribed to commands and forwarding audio chunks to main.
        </p>
      </div>
    </main>
  )
}

function PttHudWindowApp() {
  const [snapshot, setSnapshot] = useState<PttHudSnapshot>({ mode: 'hidden' })

  useEffect(() => {
    document.documentElement.setAttribute('data-surface', 'hud')

    const api = window.justSay
    if (!api) {
      return () => {
        document.documentElement.removeAttribute('data-surface')
      }
    }

    void api.getPttHudState().then((nextSnapshot) => {
      setSnapshot(nextSnapshot)
    })
    void api.getSettings().then((settings) => {
      applyThemeSetting(settings.general.theme)
    })

    const unsubscribeHud = api.onPttHudState((nextSnapshot) => {
      setSnapshot(nextSnapshot)
    })
    const unsubscribeSettings = api.onSettingsChanged((settings) => {
      applyThemeSetting(settings.general.theme)
    })

    return () => {
      unsubscribeHud()
      unsubscribeSettings()
      document.documentElement.removeAttribute('data-surface')
    }
  }, [])

  const handleCopy = () => {
    if (!window.justSay) {
      return
    }

    void window.justSay.copyLatestPttText()
  }

  const handleDismiss = () => {
    if (!window.justSay) {
      return
    }

    void window.justSay.dismissPttHud()
  }

  return (
    <main
      className={`hud-overlay ${snapshot.mode === 'recovery' ? 'hud-overlay--interactive' : ''}`}
      aria-hidden={snapshot.mode === 'hidden'}
    >
      {snapshot.mode === 'hidden' ? null : (
        <div className="hud-overlay__stage">
          <span className="sr-only" aria-live="polite">
            {describeHudLiveMessage(snapshot)}
          </span>
          {snapshot.mode === 'recording' ? (
            <div className="hud-card hud-card--recording" role="status" aria-label="Dictation recording">
              <div className="hud-card__motion hud-card__motion--recording" aria-hidden="true">
                <span />
              </div>
              <div className="hud-card__timer">{formatHudTimer(snapshot.elapsedMs)}</div>
            </div>
          ) : null}

          {snapshot.mode === 'processing' ? (
            <div className="hud-card hud-card--processing" role="status" aria-label="Dictation processing">
              <div className="hud-card__motion hud-card__motion--processing" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
            </div>
          ) : null}

          {snapshot.mode === 'sent' ? (
            <div className="hud-card hud-card--sent" role="status" aria-label="Dictation sent">
              <div className="hud-card__motion hud-card__motion--sent" aria-hidden="true">
                <span />
              </div>
            </div>
          ) : null}

          {snapshot.mode === 'recovery' ? (
            <div
              className={`hud-strip ${snapshot.tone === 'danger' ? 'hud-strip--danger' : 'hud-strip--warning'}`}
              role="alert"
            >
              <div className="hud-strip__copy">
                <div className="hud-strip__title">{snapshot.title}</div>
                <div className="hud-strip__body">{snapshot.body}</div>
              </div>
              <div className="hud-strip__actions">
                {snapshot.canCopy ? (
                  <button
                    type="button"
                    className="hud-strip__button hud-strip__button--primary"
                    onClick={handleCopy}
                  >
                    Copy
                  </button>
                ) : null}
                <button
                  type="button"
                  className="hud-strip__button hud-strip__button--ghost"
                  onClick={handleDismiss}
                >
                  Dismiss
                </button>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </main>
  )
}

function requireApi() {
  if (!window.justSay) {
    throw new Error('window.justSay is not available')
  }
  return window.justSay
}

function serviceStatusClass(status: LocalServiceStatus): 'healthy' | 'degraded' | 'failed' {
  switch (status) {
    case 'healthy':
      return 'healthy'
    case 'degraded':
    case 'starting':
      return 'degraded'
    case 'failed':
    case 'stopped':
    default:
      return 'failed'
  }
}

function describeDegradedGuidance(status: LocalServiceStatus): string {
  switch (status) {
    case 'degraded':
      return 'The speech service is responding slowly. Recognition may fall back to a lower-quality model.'
    case 'failed':
      return 'The speech service is not reachable. Dictation and meeting capture will not work until it recovers.'
    case 'stopped':
      return 'The speech service has stopped. Restart it to resume dictation and meeting capture.'
    default:
      return 'The speech service needs attention.'
  }
}

function applyThemeSetting(theme: ThemeSetting): void {
  if (theme === 'system') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light')
    return
  }

  document.documentElement.setAttribute('data-theme', theme)
}

function formatHudTimer(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000))
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0')
  const seconds = String(totalSeconds % 60).padStart(2, '0')
  return `${minutes}:${seconds}`
}

function describeHudLiveMessage(snapshot: PttHudSnapshot): string {
  switch (snapshot.mode) {
    case 'recording':
      return `Recording, ${formatHudTimer(snapshot.elapsedMs)}`
    case 'processing':
      return 'Processing dictation'
    case 'sent':
      return 'Dictation sent'
    case 'recovery':
      return `${snapshot.title}. ${snapshot.body}`
    case 'hidden':
    default:
      return ''
  }
}

function cloneLiveSession(session: RetainedLiveSession): RetainedLiveSession {
  return {
    ...session,
    transcript: {
      committedBlocks: session.transcript.committedBlocks.map((block) => ({
        ...block,
        ...(block.words ? { words: [...block.words] } : {})
      })),
      activeDrafts: Object.fromEntries(
        Object.entries(session.transcript.activeDrafts).map(([source, draft]) => [
          source,
          draft
            ? {
                ...draft,
                ...(draft.words ? { words: [...draft.words] } : {})
              }
            : draft
        ])
      ),
      revision: session.transcript.revision
    }
  }
}

function NavIcon(props: { name: string }) {
  switch (props.name) {
    case 'mic':
      return (
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path d="M10 1a3.5 3.5 0 0 0-3.5 3.5v5a3.5 3.5 0 1 0 7 0v-5A3.5 3.5 0 0 0 10 1Z" fill="currentColor" />
          <path d="M5 8.5a.75.75 0 0 0-1.5 0v1a6.5 6.5 0 0 0 5.75 6.46v2.29a.75.75 0 0 0 1.5 0v-2.29A6.5 6.5 0 0 0 16.5 9.5v-1a.75.75 0 0 0-1.5 0v1a5 5 0 0 1-10 0v-1Z" fill="currentColor" />
        </svg>
      )
    case 'session':
      return (
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path d="M3 4.5A2.5 2.5 0 0 1 5.5 2h9A2.5 2.5 0 0 1 17 4.5v8a2.5 2.5 0 0 1-2.5 2.5H12l-3.5 3v-3H5.5A2.5 2.5 0 0 1 3 12.5v-8Z" fill="currentColor" />
        </svg>
      )
    case 'archive':
      return (
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path fillRule="evenodd" clipRule="evenodd" d="M2 4.75A2.75 2.75 0 0 1 4.75 2h10.5A2.75 2.75 0 0 1 18 4.75v1a.75.75 0 0 1-.75.75H2.75A.75.75 0 0 1 2 5.75v-1ZM3.5 8v7.25c0 .69.56 1.25 1.25 1.25h10.5c.69 0 1.25-.56 1.25-1.25V8h-13Zm4.5 2.75a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 0 1.5h-2.5a.75.75 0 0 1-.75-.75Z" fill="currentColor" />
        </svg>
      )
    case 'settings':
      return (
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path fillRule="evenodd" clipRule="evenodd" d="M8.34 2.08A.75.75 0 0 1 9.07 1.5h1.86a.75.75 0 0 1 .73.58l.38 1.7a6.5 6.5 0 0 1 1.28.74l1.66-.53a.75.75 0 0 1 .86.36l.93 1.6a.75.75 0 0 1-.13.93l-1.28 1.17a6.6 6.6 0 0 1 0 1.5l1.28 1.17a.75.75 0 0 1 .13.93l-.93 1.6a.75.75 0 0 1-.86.36l-1.66-.53a6.5 6.5 0 0 1-1.28.74l-.38 1.7a.75.75 0 0 1-.73.58H9.07a.75.75 0 0 1-.73-.58l-.38-1.7a6.5 6.5 0 0 1-1.28-.74l-1.66.53a.75.75 0 0 1-.86-.36l-.93-1.6a.75.75 0 0 1 .13-.93l1.28-1.17a6.6 6.6 0 0 1 0-1.5L3.36 6.88a.75.75 0 0 1-.13-.93l.93-1.6a.75.75 0 0 1 .86-.36l1.66.53a6.5 6.5 0 0 1 1.28-.74l.38-1.7ZM10 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" fill="currentColor" />
        </svg>
      )
    default:
      return null
  }
}
