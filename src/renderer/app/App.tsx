import { useEffect, useState } from 'react'

import type {
  AppRuntimeSnapshot,
  AppSettings,
  EngineProfile,
  PaginatedHistoryResult,
  ProfileTestResult,
  SavedTranscript
} from '../../shared/api-types'
import { createDefaultSettings } from '../../core/settings/settings-schema'
import { createBrowserCaptureSourceManager } from '../capture/browser-capture-source'
import { CaptureRuntime } from '../capture/capture-runtime'
import {
  APP_SECTIONS,
  type AppSection,
  getPreferredSection
} from './app-model'
import { INITIAL_RUNTIME_SNAPSHOT, RuntimeStore } from '../features/runtime/runtime-store'
import { HistoryPage } from '../pages/history-page'
import { LiveSessionPage } from '../pages/live-session-page'
import { QuickDictationPage } from '../pages/quick-dictation-page'
import { SettingsPage } from '../pages/settings-page'

const runtimeStore = new RuntimeStore()

export function App() {
  const [runtime, setRuntime] = useState<AppRuntimeSnapshot>(INITIAL_RUNTIME_SNAPSHOT)
  const [settings, setSettings] = useState<AppSettings>(createDefaultSettings())
  const [profiles, setProfiles] = useState<EngineProfile[]>([])
  const [profileTests, setProfileTests] = useState<Record<string, ProfileTestResult | undefined>>({})
  const [history, setHistory] = useState<SavedTranscript[]>([])
  const [historyTotal, setHistoryTotal] = useState(0)
  const [selectedHistory, setSelectedHistory] = useState<SavedTranscript | null>(null)
  const [exportMessage, setExportMessage] = useState<string | null>(null)
  const [activeSection, setActiveSection] = useState<AppSection>('quick-dictation')
  const [historyQuery, setHistoryQuery] = useState('')
  const [historyMode, setHistoryMode] = useState<'all' | SavedTranscript['mode']>('all')
  const [error, setError] = useState<string | null>(null)
  const [busyAction, setBusyAction] = useState<string | null>(null)

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

  async function refreshHistory(): Promise<void> {
    const historyPage = await loadHistoryPage(requireApi(), historyQuery, historyMode)
    setHistory(historyPage.items)
    setHistoryTotal(historyPage.total)

    if (selectedHistory) {
      const freshSelection = historyPage.items.find((item) => item.id === selectedHistory.id)

      if (freshSelection) {
        const transcript = await requireApi().getHistory(selectedHistory.id)
        setSelectedHistory(transcript)
      } else {
        setSelectedHistory(null)
      }
    }
  }

  async function refreshAll(): Promise<void> {
    const api = requireApi()
    const [runtimeSnapshot, appSettings, speechProfiles] = await Promise.all([
      runtimeStore.refresh(api),
      api.getSettings(),
      api.listSpeechProfiles()
    ])

    setRuntime(runtimeSnapshot)
    setSettings(appSettings)
    setProfiles(speechProfiles)
    await refreshHistory()
  }

  async function refreshRuntimeOnly(): Promise<void> {
    const runtimeSnapshot = await runtimeStore.refresh(requireApi())
    setRuntime(runtimeSnapshot)
  }

  async function runAction(label: string, action: () => Promise<void>): Promise<void> {
    setBusyAction(label)
    setError(null)

    try {
      setExportMessage(null)
      await action()
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Unknown action error')
    } finally {
      setBusyAction(null)
    }
  }

  useEffect(() => {
    const api = requireApi()
    const disconnect = runtimeStore.connect((snapshot) => {
      setRuntime(snapshot)
    }, api)

    return () => {
      disconnect()
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    async function bootstrap(): Promise<void> {
      try {
        await refreshAll()

        if (cancelled) {
          return
        }

        setActiveSection((current) => (current === 'quick-dictation' ? getPreferredSection(runtimeStore.getSnapshot()) : current))
      } catch (bootstrapError) {
        if (cancelled) {
          return
        }

        setError(bootstrapError instanceof Error ? bootstrapError.message : 'Unknown bootstrap error')
      }
    }

    void bootstrap()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (window.location.hash !== '#capture' || !window.justSayCapture) {
      return
    }

    const captureRuntime = new CaptureRuntime(window.justSayCapture, createBrowserCaptureSourceManager())
    captureRuntime.start()

    return () => {
      captureRuntime.dispose()
    }
  }, [])

  useEffect(() => {
    if (runtime.liveSession && activeSection === 'quick-dictation') {
      setActiveSection('live-session')
    }
  }, [activeSection, runtime.liveSession])

  useEffect(() => {
    let cancelled = false

    async function refreshHistoryEffect(): Promise<void> {
      try {
        const historyPage = await loadHistoryPage(requireApi(), historyQuery, historyMode)

        if (cancelled) {
          return
        }

        setHistory(historyPage.items)
        setHistoryTotal(historyPage.total)
      } catch (historyError) {
        if (cancelled) {
          return
        }

        setError(historyError instanceof Error ? historyError.message : 'Unknown history error')
      }
    }

    void refreshHistoryEffect()

    return () => {
      cancelled = true
    }
  }, [historyMode, historyQuery])

  if (window.location.hash === '#capture') {
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

  const nextTheme = settings.general.theme === 'light' ? 'dark' : 'light'
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
            void runAction('refresh', refreshAll)
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
              setActiveSection(section.id)
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

      {activeSection === 'quick-dictation' ? (
        <QuickDictationPage
          runtime={runtime}
          settings={settings}
          busyAction={busyAction}
          pttStartDisabled={pttStartDisabled}
          pttStopDisabled={pttStopDisabled}
          palette={palette}
          onStartPtt={() => {
            void runAction('ptt-start', async () => {
              await requireApi().startPtt()
              await refreshRuntimeOnly()
            })
          }}
          onStopPtt={() => {
            void runAction('ptt-stop', async () => {
              await requireApi().stopPtt()
              await refreshAll()
            })
          }}
          onOpenLiveSession={() => {
            setActiveSection('live-session')
          }}
        />
      ) : null}

      {activeSection === 'live-session' ? (
        <LiveSessionPage
          runtime={runtime}
          settings={settings}
          busyAction={busyAction}
          meetingStartDisabled={meetingStartDisabled}
          meetingStopDisabled={meetingStopDisabled}
          palette={palette}
          onStartMeeting={() => {
            void runAction('meeting-start', async () => {
              await requireApi().startMeeting({
                includeMicrophone: settings.input.includeMicrophoneInMeeting,
                translationEnabled: settings.translation.enabledForMeeting,
                ...(settings.translation.enabledForMeeting
                  ? { targetLanguage: settings.translation.targetLanguage }
                  : {})
              })
              await refreshRuntimeOnly()
            })
          }}
          onStopMeeting={() => {
            void runAction('meeting-stop', async () => {
              await requireApi().stopMeeting()
              await refreshAll()
            })
          }}
          onOpenHistory={() => {
            setActiveSection('history')
          }}
        />
      ) : null}

      {activeSection === 'history' ? (
        <HistoryPage
          items={history}
          total={historyTotal}
          searchQuery={historyQuery}
          selectedMode={historyMode}
          selectedTranscript={selectedHistory}
          exportMessage={exportMessage}
          busyAction={busyAction}
          palette={palette}
          onSearchQueryChange={setHistoryQuery}
          onModeChange={setHistoryMode}
          onOpen={(id) => {
            void runAction(`open:${id}`, async () => {
              const transcript = await requireApi().getHistory(id)
              setSelectedHistory(transcript)
            })
          }}
          onDelete={(id) => {
            void runAction(`delete:${id}`, async () => {
              await requireApi().deleteHistory(id)
              if (selectedHistory?.id === id) {
                setSelectedHistory(null)
              }
              await refreshAll()
            })
          }}
          onExport={(id, format) => {
            void runAction(`export:${id}:${format}`, async () => {
              const result = await requireApi().exportHistory(id, format)
              setExportMessage(result.ok ? `Exported to ${result.path}` : result.error ?? 'Export failed')
            })
          }}
        />
      ) : null}

      {activeSection === 'settings' ? (
        <SettingsPage
          settings={settings}
          profiles={profiles}
          profileTests={profileTests}
          busyAction={busyAction}
          palette={palette}
          onToggleTheme={() => {
            void runAction('theme', async () => {
              const updated = await requireApi().updateSettings({
                general: {
                  theme: nextTheme
                }
              })

              setSettings(updated)
            })
          }}
          onSelectProfile={(profileId) => {
            void runAction(`profile-select:${profileId}`, async () => {
              const updated = await requireApi().updateSettings({
                speech: {
                  selectedProfileId: profileId
                }
              })
              setSettings(updated)
            })
          }}
          onTestProfile={(profileId) => {
            void runAction(`profile-test:${profileId}`, async () => {
              const result = await requireApi().testSpeechProfile(profileId)
              setProfileTests((current) => ({
                ...current,
                [profileId]: result
              }))
              await refreshRuntimeOnly()
            })
          }}
        />
      ) : null}
    </main>
  )
}

function requireApi() {
  if (!window.justSay) {
    throw new Error('window.justSay is not available')
  }

  return window.justSay
}

async function loadHistoryPage(
  api: ReturnType<typeof requireApi>,
  query: string,
  mode: 'all' | SavedTranscript['mode']
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
