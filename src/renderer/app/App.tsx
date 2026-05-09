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
  const serviceLabel = serviceStatus === 'healthy' ? 'Service connected' : `Service ${serviceStatus}`

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '160px 1fr',
      minHeight: '100vh',
    }}>
      <nav style={{
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-surface)',
        borderRight: '1px solid var(--border-subtle)',
        padding: '24px 0',
        gap: 2,
      }}>
        <div style={{
          padding: '0 16px 20px',
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: '0.04em',
          color: 'var(--text-secondary)',
        }}>
          JustSay
        </div>

        {APP_SECTIONS.map((section) => {
          const isActive = activeSection === section.id
          return (
          <button
            key={section.id}
            type="button"
            data-active={isActive ? '' : undefined}
            onClick={() => controller.setActiveSection(section.id)}
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              border: 'none',
              borderRadius: 0,
              padding: '10px 16px',
              background: isActive ? 'var(--accent-muted)' : 'transparent',
              color: isActive ? 'var(--accent-text)' : 'var(--text-secondary)',
              fontWeight: isActive ? 600 : 400,
              fontSize: 14,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {section.label}
          </button>
          )
        })}

        <div style={{ flex: 1 }} />

        <div style={{
          padding: '12px 16px',
          fontSize: 12,
          color: 'var(--text-tertiary)',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}>
          <span style={{
            display: 'inline-block',
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: serviceColor(serviceStatus),
          }} />
          {serviceLabel}
        </div>

        <button
          type="button"
          onClick={() => { void controller.refresh() }}
          disabled={Boolean(busyAction)}
          style={{
            margin: '0 12px 4px',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            padding: '7px 12px',
            background: 'transparent',
            color: 'var(--text-secondary)',
            fontSize: 12,
            cursor: Boolean(busyAction) ? 'not-allowed' : 'pointer',
            fontFamily: 'inherit',
            opacity: Boolean(busyAction) ? 0.5 : 1,
          }}
        >
          {busyAction === 'refresh' ? 'Refreshing\u2026' : 'Refresh'}
        </button>
      </nav>

      <main style={{
        padding: '32px 40px 48px',
        overflow: 'auto',
        maxHeight: '100vh',
      }}>
        {error ? (
          <div style={{
            marginBottom: 20,
            padding: '10px 14px',
            background: 'var(--danger-muted)',
            border: '1px solid var(--danger)',
            borderRadius: 'var(--radius)',
            fontSize: 13,
          }}>
            <strong>Error:</strong> {error}
          </div>
        ) : null}

        {latestNotification ? (
          <div style={{
            marginBottom: 20,
            padding: '10px 14px',
            background: 'var(--bg-surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            fontSize: 13,
          }}>
            <strong>{latestNotification.level}:</strong> {latestNotification.message}
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
    <main style={{
      minHeight: '100vh',
      display: 'grid',
      placeItems: 'center',
      padding: 24,
      background: 'var(--bg-page)',
      color: 'var(--text-primary)',
    }}>
      <div>
        <div style={{ fontSize: 12, letterSpacing: '0.04em', color: 'var(--text-tertiary)' }}>Capture Window</div>
        <h1 style={{ margin: '8px 0 0', fontSize: 20, fontWeight: 600 }}>Capture runtime ready</h1>
        <p style={{ margin: '8px 0 0', color: 'var(--text-secondary)', maxWidth: '50ch' }}>
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
