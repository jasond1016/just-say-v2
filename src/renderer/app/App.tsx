import { useEffect, useMemo, useSyncExternalStore } from 'react'

import { createBrowserCaptureSourceManager } from '../capture/browser-capture-source'
import { CaptureRuntime } from '../capture/capture-runtime'
import { APP_SECTIONS } from './app-model'
import { RuntimeStore } from '../features/runtime/runtime-store'
import { HistoryPage } from '../pages/history-page'
import { LiveSessionPage } from '../pages/live-session-page'
import { QuickDictationPage } from '../pages/quick-dictation-page'
import { SettingsPage } from '../pages/settings-page'
import { AppController } from './app-controller'
import type { LocalServiceStatus } from '../../shared/api-types'
import { Button } from '../ui/controls'
import { describeLocalServiceStatus } from '../ui/copy'

export function App() {
  if (window.location.hash === '#capture') {
    return <CaptureWindowApp />
  }

  return <WorkspaceApp />
}

function serviceColor(status: LocalServiceStatus): string {
  switch (status) {
    case 'healthy':
      return 'var(--success)'
    case 'degraded':
      return 'var(--accent)'
    case 'failed':
      return 'var(--danger)'
    default:
      return 'var(--text-tertiary)'
  }
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

  const liveSession = runtime.liveSession
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
        <div className="app-sidebar__brand">JustSay</div>

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
              {section.label}
            </button>
          )
        })}

        <div className="app-sidebar__spacer" />

        <div className="app-sidebar__status" role="status" aria-live="polite">
          <span className="app-sidebar__status-dot" style={{ background: serviceColor(serviceStatus) }} />
          {serviceLabel}
        </div>

        <Button
          label={busyAction === 'refresh' ? 'Refreshing\u2026' : 'Refresh'}
          variant="secondary"
          size="small"
          disabled={Boolean(busyAction)}
          className="app-sidebar__refresh"
          onClick={() => { void controller.refresh() }}
        />
      </nav>

      <main className="app-main">
        {error ? (
          <div className="app-banner app-banner--error" role="alert">
            <strong>Action needed:</strong> {error}
          </div>
        ) : null}

        {latestNotification ? (
          <div
            className="app-banner"
            role={latestNotification.level === 'error' ? 'alert' : 'status'}
            aria-live={latestNotification.level === 'error' ? 'assertive' : 'polite'}
          >
            <strong>{formatNotificationLevel(latestNotification.level)}:</strong> {latestNotification.message}
          </div>
        ) : null}

        {activeSection === 'quick-dictation' ? (
          <QuickDictationPage
            runtime={runtime}
            settings={settings}
            busyAction={busyAction}
            pttStartDisabled={pttStartDisabled}
            pttStopDisabled={pttStopDisabled}
            onStartPtt={() => { void controller.startPtt() }}
            onStopPtt={() => { void controller.stopPtt() }}
            onCopyLatestText={() => { void controller.copyLatestPttText() }}
            onOpenLiveSession={() => { controller.openLiveSessionSection() }}
          />
        ) : null}

        {activeSection === 'live-session' ? (
          <LiveSessionPage
            runtime={runtime}
            settings={settings}
            busyAction={busyAction}
            liveSessionMessage={liveSessionMessage}
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
            exportMessage={exportMessage}
            busyAction={busyAction}
            onOpenQuickDictation={() => { controller.setActiveSection('quick-dictation') }}
            onOpenLiveSession={() => { controller.openLiveSessionSection() }}
            onSearchQueryChange={(query) => { void controller.setHistoryQuery(query) }}
            onModeChange={(mode) => { void controller.setHistoryMode(mode) }}
            onSourceChange={(source) => { void controller.setHistorySource(source) }}
            onTimeFilterChange={(timeFilter) => { void controller.setHistoryTimeFilter(timeFilter) }}
            onOpen={(id) => { void controller.openHistoryItem(id) }}
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
            onLocalServiceHostChange={(host) => { void controller.setLocalServiceHost(host) }}
            onLocalServicePortChange={(port) => { void controller.setLocalServicePort(port) }}
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
