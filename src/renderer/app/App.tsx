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

  const theme = settings.general.theme === 'light' ? 'light' : 'dark'
  const palette =
    theme === 'light'
      ? {
          page: '#f4f0e8',
          panel: 'rgba(255, 255, 255, 0.86)',
          panelSoft: 'rgba(255, 255, 255, 0.74)',
          text: '#1a2330',
          muted: '#5f6d81',
          accent: '#0f766e',
          border: 'rgba(26, 35, 48, 0.12)',
          dangerBorder: 'rgba(176, 60, 60, 0.28)',
          dangerBg: 'rgba(176, 60, 60, 0.08)'
        }
      : {
          page: '#0b1118',
          panel: 'rgba(8, 14, 22, 0.72)',
          panelSoft: 'rgba(255, 255, 255, 0.03)',
          text: '#edf2f7',
          muted: '#9ab0ca',
          accent: '#5eead4',
          border: 'rgba(255, 255, 255, 0.08)',
          dangerBorder: 'rgba(255, 128, 128, 0.35)',
          dangerBg: 'rgba(128, 20, 20, 0.22)'
        }

  useEffect(() => {
    return controller.start()
  }, [controller])

  const liveSession = runtime.liveSession
  const meetingActive = Boolean(liveSession)
  const pttStartDisabled = Boolean(busyAction) || runtime.ptt.status !== 'idle'
  const pttStopDisabled = Boolean(busyAction) || runtime.ptt.status !== 'capturing'
  const meetingStartDisabled = Boolean(busyAction) || meetingActive
  const meetingStopDisabled = Boolean(busyAction) || !liveSession || liveSession.status !== 'streaming'

  return (
    <main
      style={{
        minHeight: '100vh',
        padding: '32px 24px 48px',
        display: 'grid',
        gap: 20,
        background: `radial-gradient(circle at top right, ${palette.accent}18, transparent 28%), linear-gradient(180deg, ${palette.page}, ${palette.page})`,
        color: palette.text
      }}
    >
      <section
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 18,
          alignItems: 'flex-start',
          flexWrap: 'wrap'
        }}
      >
        <div>
          <div
            style={{
              fontSize: 12,
              textTransform: 'uppercase',
              letterSpacing: '0.16em',
              color: palette.muted
            }}
          >
            JustSay V2
          </div>
          <h1 style={{ margin: '10px 0 0', fontSize: 38, lineHeight: 1.02 }}>Speech workspace</h1>
          <p style={{ margin: '10px 0 0', maxWidth: 760, color: palette.muted }}>
            One shell, four focused areas: fast dictation, long-running live transcript, searchable history, and compact settings.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            void controller.refresh()
          }}
          disabled={Boolean(busyAction)}
          style={toolbarButtonStyle(Boolean(busyAction))}
        >
          {busyAction === 'refresh' ? 'Refreshing...' : 'Refresh'}
        </button>
      </section>

      <nav
        style={{
          display: 'flex',
          gap: 10,
          flexWrap: 'wrap'
        }}
      >
        {APP_SECTIONS.map((section) => (
          <button
            key={section.id}
            type="button"
            onClick={() => {
              controller.setActiveSection(section.id)
            }}
            style={{
              border: `1px solid ${palette.border}`,
              borderRadius: 999,
              padding: '10px 14px',
              background: activeSection === section.id ? palette.panel : 'transparent',
              color: activeSection === section.id ? palette.text : palette.muted,
              cursor: 'pointer'
            }}
          >
            {section.label}
          </button>
        ))}
      </nav>

      {error ? (
        <section
          style={{
            border: `1px solid ${palette.dangerBorder}`,
            background: palette.dangerBg,
            borderRadius: 18,
            padding: 16
          }}
        >
          <strong>Runtime error:</strong> {error}
        </section>
      ) : null}

      {latestNotification ? (
        <section
          style={{
            border: `1px solid ${palette.border}`,
            background: palette.panelSoft,
            borderRadius: 18,
            padding: 16
          }}
        >
          <strong>{latestNotification.level.toUpperCase()}:</strong> {latestNotification.message}
        </section>
      ) : null}

      {activeSection === 'quick-dictation' ? (
        <QuickDictationPage
          runtime={runtime}
          settings={settings}
          busyAction={busyAction}
          pttStartDisabled={pttStartDisabled}
          pttStopDisabled={pttStopDisabled}
          palette={palette}
          onStartPtt={() => {
            void controller.startPtt()
          }}
          onStopPtt={() => {
            void controller.stopPtt()
          }}
          onOpenLiveSession={() => {
            controller.openLiveSessionSection()
          }}
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
          palette={palette}
          onStartMeeting={() => {
            void controller.startMeeting()
          }}
          onStopMeeting={() => {
            void controller.stopMeeting()
          }}
          onCopyLiveSession={() => {
            void controller.copyLiveSession()
          }}
          onExportLiveSession={(format) => {
            void controller.exportLiveSession(format)
          }}
          onOpenHistory={() => {
            controller.openHistorySection()
          }}
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
          palette={palette}
          onSearchQueryChange={(query) => {
            void controller.setHistoryQuery(query)
          }}
          onModeChange={(mode) => {
            void controller.setHistoryMode(mode)
          }}
          onSourceChange={(source) => {
            void controller.setHistorySource(source)
          }}
          onTimeFilterChange={(timeFilter) => {
            void controller.setHistoryTimeFilter(timeFilter)
          }}
          onOpen={(id) => {
            void controller.openHistoryItem(id)
          }}
          onDelete={(id) => {
            void controller.deleteHistoryItem(id)
          }}
          onCopy={(id, format) => {
            void controller.copyHistoryItem(id, format)
          }}
          onExport={(id, format) => {
            void controller.exportHistoryItem(id, format)
          }}
        />
      ) : null}

      {activeSection === 'settings' ? (
        <SettingsPage
          settings={settings}
          profiles={profiles}
          profileTests={profileTests}
          diagnosticsMessage={diagnosticsMessage}
          busyAction={busyAction}
          palette={palette}
          onGeneralLanguageChange={(language) => {
            void controller.setGeneralLanguage(language)
          }}
          onThemeChange={(theme) => {
            void controller.setTheme(theme)
          }}
          onMinimizeToTrayChange={(minimizeToTray) => {
            void controller.setMinimizeToTray(minimizeToTray)
          }}
          onSelectProfile={(profileId) => {
            void controller.selectProfile(profileId)
          }}
          onTestProfile={(profileId) => {
            void controller.testProfile(profileId)
          }}
          onSpeechLanguageChange={(language) => {
            void controller.setSpeechLanguage(language)
          }}
          onPttHotkeyChange={(hotkey) => {
            void controller.setPttHotkey(hotkey)
          }}
          onOutputMethodChange={(method) => {
            void controller.setOutputMethod(method)
          }}
          onIncludeMicrophoneChange={(enabled) => {
            void controller.setIncludeMicrophoneInMeeting(enabled)
          }}
          onTranslatePttChange={(enabled) => {
            void controller.setTranslationEnabledForPtt(enabled)
          }}
          onTranslateMeetingChange={(enabled) => {
            void controller.setTranslationEnabledForMeeting(enabled)
          }}
          onTranslationTargetLanguageChange={(targetLanguage) => {
            void controller.setTranslationTargetLanguage(targetLanguage)
          }}
          onTranslationProviderChange={(provider) => {
            void controller.setTranslationProvider(provider)
          }}
          onLocalServiceHostChange={(host) => {
            void controller.setLocalServiceHost(host)
          }}
          onLocalServicePortChange={(port) => {
            void controller.setLocalServicePort(port)
          }}
          onExportDiagnostics={() => {
            void controller.exportDiagnostics()
          }}
        />
      ) : null}
    </main>
  )
}

function CaptureWindowApp() {
  useEffect(() => {
    if (!window.justSayCapture) {
      return
    }

    const captureRuntime = new CaptureRuntime(window.justSayCapture, createBrowserCaptureSourceManager())
    captureRuntime.start()

    return () => {
      captureRuntime.dispose()
    }
  }, [])

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: 24,
        background: 'radial-gradient(circle at top, rgba(94, 234, 212, 0.12), transparent 42%), #071018',
        color: '#d9e7f5'
      }}
    >
      <section
        style={{
          width: 'min(560px, 100%)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: 24,
          padding: 24,
          background: 'rgba(8, 14, 22, 0.76)'
        }}
      >
        <div style={{ fontSize: 12, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#8aa2bf' }}>
          Capture Window
        </div>
        <h1 style={{ margin: '10px 0 0', fontSize: 28 }}>Capture runtime ready</h1>
        <p style={{ margin: '12px 0 0', color: '#b7c8db' }}>
          The hidden capture surface is subscribed to commands and can forward audio chunks back to main.
        </p>
      </section>
    </main>
  )
}

function requireApi() {
  if (!window.justSay) {
    throw new Error('window.justSay is not available')
  }

  return window.justSay
}
function toolbarButtonStyle(disabled: boolean) {
  return {
    border: '1px solid rgba(255, 255, 255, 0.12)',
    borderRadius: 999,
    padding: '12px 16px',
    background: disabled ? 'rgba(120, 130, 145, 0.18)' : 'rgba(22, 163, 74, 0.18)',
    color: '#f6fbff',
    cursor: disabled ? 'not-allowed' : 'pointer'
  } as const
}
