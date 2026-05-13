import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'

import { createBrowserCaptureSourceManager } from '../capture/browser-capture-source'
import { CaptureRuntime } from '../capture/capture-runtime'
import { RuntimeStore } from '../features/runtime/runtime-store'
import { HistoryPage } from '../pages/history-page'
import { LiveSessionPage } from '../pages/live-session-page'
import { QuickDictationPage } from '../pages/quick-dictation-page'
import { SettingsPage } from '../pages/settings-page'
import { Button } from '../ui/controls'
import { describeLocalServiceStatus } from '../ui/copy'
import type { AppRuntimeSnapshot, LocalServiceStatus } from '../../shared/api-types'
import { APP_SECTIONS } from './app-model'
import { AppController } from './app-controller'

type RetainedLiveSession = NonNullable<AppRuntimeSnapshot['liveSession']>

export function App() {
  if (window.location.hash === '#capture') {
    return <CaptureWindowApp />
  }

  return <WorkspaceApp />
}

function WorkspaceApp() {
  const controller = useMemo(() => {
    return new AppController({
      api: requireApi(),
      runtimeStore: new RuntimeStore()
    })
  }, [])
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  const {
    runtime,
    settings,
    profiles,
    profileTests,
    history,
    historyTotal,
    selectedHistory,
    selectedHistoryAudio,
    exportMessage,
    liveSessionMessage,
    diagnosticsMessage,
    activeSection,
    historyQuery,
    historyMode,
    historySource,
    historyTimeFilter,
    latestNotification,
    error,
    busyAction
  } = state
  const [retainedLiveSession, setRetainedLiveSession] = useState<RetainedLiveSession | null>(null)

  useEffect(() => {
    const theme = settings.general.theme
    if (theme === 'system') {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light')
    } else {
      document.documentElement.setAttribute('data-theme', theme)
    }
  }, [settings.general.theme])

  useEffect(() => {
    return controller.start()
  }, [controller])

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

  return (
    <div className="app-shell">
      <nav className="app-sidebar" aria-label="Workspace sections">
        <div className="app-sidebar__brand">
          <div className="app-sidebar__brand-mark">JustSay</div>
          <div className="app-sidebar__brand-sub">Voice workspace</div>
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
                <span className="app-nav-button__dot" aria-hidden="true" />
                <span>{section.label}</span>
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
                onClick={() => { void controller.refresh() }}
              >
                {busyAction === 'refresh' ? 'Restarting...' : 'Restart service'}
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

          <Button
            label={busyAction === 'refresh' ? 'Refreshing...' : 'Refresh'}
            variant="ghost"
            size="small"
            disabled={Boolean(busyAction)}
            className="app-sidebar__refresh"
            onClick={() => { void controller.refresh() }}
          />
        </div>
      </nav>

      <main className="app-main">
        {error || latestNotification ? (
          <div className="app-main__notes">
            {error ? (
              <div className="app-note app-note--error" role="alert">
                <strong>Action needed</strong>
                <span>{error}</span>
              </div>
            ) : null}

            {latestNotification ? (
              <div
                className={`app-note app-note--${latestNotification.level}`}
                role={latestNotification.level === 'error' ? 'alert' : 'status'}
                aria-live={latestNotification.level === 'error' ? 'assertive' : 'polite'}
              >
                <strong>{formatNotificationLevel(latestNotification.level)}</strong>
                <span>{latestNotification.message}</span>
              </div>
            ) : null}
          </div>
        ) : null}

        {activeSection === 'quick-dictation' ? (
          <QuickDictationPage
            runtime={runtime}
            settings={settings}
            localServiceStatus={serviceStatus}
            recentDictations={history.filter((item) => item.mode === 'ptt').slice(0, 5)}
            onCopyText={(id) => { void controller.copyHistoryItem(id, 'plain_text') }}
            onOpenHistory={() => { controller.openHistorySection() }}
          />
        ) : null}

        {activeSection === 'live-session' ? (
          <LiveSessionPage
            liveSession={displayLiveSession}
            activeRuntimeSession={liveSession}
            settings={settings}
            busyAction={busyAction}
            liveSessionMessage={liveSessionMessage}
            localServiceStatus={serviceStatus}
            meetingStartDisabled={meetingStartDisabled}
            meetingStopDisabled={meetingStopDisabled}
            onStartMeeting={() => { void controller.startMeeting() }}
            onStopMeeting={() => { void controller.stopMeeting() }}
            onCopyLiveSession={() => { void controller.copyLiveSession() }}
            onExportLiveSession={(format) => { void controller.exportLiveSession(format) }}
            onOpenHistory={() => { controller.openHistorySection() }}
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
            onCopy={(id, format) => { void controller.copyHistoryItem(id, format) }}
            onExport={(id, format) => { void controller.exportHistoryItem(id, format) }}
          />
        ) : null}

        {activeSection === 'settings' ? (
          <SettingsPage
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
      </main>
    </div>
  )
}

function CaptureWindowApp() {
  useEffect(() => {
    if (!window.justSayCapture) return

    const captureRuntime = new CaptureRuntime(window.justSayCapture, createBrowserCaptureSourceManager())
    captureRuntime.start()
    return () => { captureRuntime.dispose() }
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

function formatNotificationLevel(level: 'info' | 'warning' | 'error') {
  switch (level) {
    case 'info':
      return 'Note'
    case 'warning':
      return 'Warning'
    case 'error':
      return 'Action needed'
    default:
      return level
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
