import { useEffect, useState } from 'react'

import type { AppRuntimeSnapshot, AppSettings, SavedTranscript } from '../../shared/api-types'
import { createDefaultSettings } from '../../core/settings/settings-schema'
import { INITIAL_RUNTIME_SNAPSHOT, RuntimeStore } from '../features/runtime/runtime-store'

const runtimeStore = new RuntimeStore()

export function App() {
  const [runtime, setRuntime] = useState<AppRuntimeSnapshot>(INITIAL_RUNTIME_SNAPSHOT)
  const [settings, setSettings] = useState<AppSettings>(createDefaultSettings())
  const [history, setHistory] = useState<SavedTranscript[]>([])
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

  async function refreshAll(): Promise<void> {
    const api = window.justSay

    if (!api) {
      throw new Error('window.justSay is not available')
    }

    const [runtimeSnapshot, appSettings, historyPage] = await Promise.all([
      runtimeStore.refresh(api),
      api.getSettings(),
      api.listHistory()
    ])

    setRuntime(runtimeSnapshot)
    setSettings(appSettings)
    setHistory(historyPage.items)
  }

  async function refreshRuntimeOnly(): Promise<void> {
    const api = window.justSay

    if (!api) {
      throw new Error('window.justSay is not available')
    }

    const runtimeSnapshot = await runtimeStore.refresh(api)
    setRuntime(runtimeSnapshot)
  }

  async function runAction(label: string, action: () => Promise<void>): Promise<void> {
    setBusyAction(label)
    setError(null)

    try {
      await action()
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Unknown action error')
    } finally {
      setBusyAction(null)
    }
  }

  useEffect(() => {
    let cancelled = false

    async function bootstrap(): Promise<void> {
      try {
        await refreshAll()

        if (cancelled) {
          return
        }
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
    if (!runtime.liveSession) {
      return
    }

    let cancelled = false
    const intervalId = window.setInterval(() => {
      void refreshRuntimeOnly().catch((pollError) => {
        if (cancelled) {
          return
        }

        setError(pollError instanceof Error ? pollError.message : 'Unknown runtime refresh error')
      })
    }, 800)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [runtime.liveSession?.sessionId, runtime.liveSession?.status])

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
          <h1 style={{ margin: '10px 0 0', fontSize: 28 }}>Audio capture surface placeholder</h1>
          <p style={{ margin: '12px 0 0', color: '#b7c8db' }}>
            V2 capture transport is wired, but this slice keeps the window intentionally minimal.
          </p>
        </section>
      </main>
    )
  }

  const nextTheme = settings.general.theme === 'light' ? 'dark' : 'light'
  const liveSession = runtime.liveSession
  const meetingActive = Boolean(liveSession)
  const meetingStartDisabled = Boolean(busyAction) || meetingActive
  const meetingStopDisabled = Boolean(busyAction) || !liveSession || liveSession.status !== 'streaming'

  return (
    <main
      style={{
        minHeight: '100vh',
        padding: '40px 32px 56px',
        display: 'grid',
        gap: '20px',
        background: `radial-gradient(circle at top right, ${palette.accent}18, transparent 28%), linear-gradient(180deg, ${palette.page}, ${palette.page})`,
        color: palette.text
      }}
    >
      <section>
        <div
          style={{
            fontSize: 12,
            textTransform: 'uppercase',
            letterSpacing: '0.14em',
            color: palette.muted,
            marginBottom: 10
          }}
        >
          JustSay V2
        </div>
        <h1
          style={{
            margin: 0,
            fontSize: 36,
            lineHeight: 1.05
          }}
        >
          Speech workspace shell
        </h1>
        <p
          style={{
            margin: '10px 0 0',
            maxWidth: 720,
            color: palette.muted
          }}
        >
          This is the first runnable Electron shell wired to the V2 contracts. Runtime, settings,
          and history are flowing through the typed preload API.
        </p>
      </section>

      {error ? (
        <section
          style={{
            border: `1px solid ${palette.dangerBorder}`,
            background: palette.dangerBg,
            borderRadius: 18,
            padding: 16
          }}
        >
          <strong>Bootstrap error:</strong> {error}
        </section>
      ) : null}

      <section
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 12
        }}
      >
        <ActionButton
          label={busyAction === 'refresh' ? 'Refreshing...' : 'Refresh shell'}
          disabled={Boolean(busyAction)}
          onClick={() => {
            void runAction('refresh', refreshAll)
          }}
        />
        <ActionButton
          label={`Theme: ${settings.general.theme}`}
          disabled={Boolean(busyAction)}
          onClick={() => {
            void runAction('theme', async () => {
              const api = window.justSay

              if (!api) {
                throw new Error('window.justSay is not available')
              }

              const updated = await api.updateSettings({
                general: {
                  theme: nextTheme
                }
              })

              setSettings(updated)
              await refreshRuntimeOnly()
            })
          }}
        />
        <ActionButton
          label={busyAction === 'meeting-start' ? 'Starting meeting...' : 'Start meeting demo'}
          disabled={meetingStartDisabled}
          onClick={() => {
            void runAction('meeting-start', async () => {
              const api = window.justSay

              if (!api) {
                throw new Error('window.justSay is not available')
              }

              await api.startMeeting({
                includeMicrophone: settings.input.includeMicrophoneInMeeting,
                translationEnabled: settings.translation.enabledForMeeting,
                ...(settings.translation.enabledForMeeting
                  ? { targetLanguage: settings.translation.targetLanguage }
                  : {})
              })
              await refreshRuntimeOnly()
            })
          }}
        />
        <ActionButton
          label={busyAction === 'meeting-stop' ? 'Stopping meeting...' : 'Stop meeting'}
          disabled={meetingStopDisabled}
          onClick={() => {
            void runAction('meeting-stop', async () => {
              const api = window.justSay

              if (!api) {
                throw new Error('window.justSay is not available')
              }

              await api.stopMeeting()
              await refreshAll()
            })
          }}
        />
      </section>

      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: 16
        }}
      >
        <InfoCard
          title="PTT Runtime"
          value={runtime.ptt.status}
          detail={runtime.ptt.lastResult?.text ?? 'No delivered result yet'}
          palette={palette}
        />
        <InfoCard
          title="Live Session"
          value={runtime.liveSession?.status ?? 'idle'}
          detail={
            runtime.liveSession
              ? `${runtime.liveSession.transcript.committedBlocks.length} committed blocks`
              : 'No active meeting session'
          }
          palette={palette}
        />
        <InfoCard
          title="Speech Profile"
          value={settings.speech.selectedProfileId}
          detail={`Language: ${settings.speech.language}`}
          palette={palette}
        />
      </section>

      <section
        style={{
          border: `1px solid ${palette.border}`,
          background: palette.panel,
          borderRadius: 24,
          padding: 20
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 12,
            alignItems: 'center',
            flexWrap: 'wrap'
          }}
        >
          <h2 style={{ margin: 0, fontSize: 20 }}>Recent History</h2>
          <div style={{ color: palette.muted, fontSize: 13 }}>
            {meetingActive
              ? `Meeting ${liveSession?.status ?? 'active'}`
              : `${history.length} saved transcript${history.length === 1 ? '' : 's'}`}
          </div>
        </div>
        <div style={{ marginTop: 14, display: 'grid', gap: 12 }}>
          {history.length === 0 ? (
            <div style={{ color: palette.muted }}>No saved transcripts yet.</div>
          ) : (
            history.map((item) => (
              <article
                key={item.id}
                style={{
                  border: `1px solid ${palette.border}`,
                  borderRadius: 18,
                  padding: 14,
                  background: palette.panelSoft
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 12,
                    alignItems: 'flex-start',
                    flexWrap: 'wrap'
                  }}
                >
                  <div>
                    <div style={{ fontSize: 13, color: palette.muted, marginBottom: 6 }}>
                      {item.mode}
                    </div>
                    <div style={{ fontSize: 16, fontWeight: 600 }}>{item.title}</div>
                  </div>
                  <ActionButton
                    label={busyAction === `delete:${item.id}` ? 'Deleting...' : 'Delete'}
                    disabled={Boolean(busyAction)}
                    onClick={() => {
                      void runAction(`delete:${item.id}`, async () => {
                        const api = window.justSay

                        if (!api) {
                          throw new Error('window.justSay is not available')
                        }

                        await api.deleteHistory(item.id)
                        await refreshAll()
                      })
                    }}
                  />
                </div>
                <div style={{ marginTop: 6, color: palette.text }}>{item.plainText}</div>
                {item.translatedPlainText ? (
                  <div style={{ marginTop: 8, color: palette.muted }}>{item.translatedPlainText}</div>
                ) : null}
              </article>
            ))
          )}
        </div>
      </section>
    </main>
  )
}

function ActionButton(props: { label: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      style={{
        border: '1px solid rgba(255, 255, 255, 0.12)',
        borderRadius: 999,
        padding: '10px 14px',
        background: props.disabled ? 'rgba(120, 130, 145, 0.18)' : 'rgba(22, 163, 74, 0.18)',
        color: '#f6fbff',
        cursor: props.disabled ? 'not-allowed' : 'pointer'
      }}
    >
      {props.label}
    </button>
  )
}

function InfoCard(props: {
  title: string
  value: string
  detail: string
  palette: {
    panelSoft: string
    border: string
    muted: string
    text: string
  }
}) {
  return (
    <section
      style={{
        border: `1px solid ${props.palette.border}`,
        background: props.palette.panelSoft,
        borderRadius: 22,
        padding: 18
      }}
    >
      <div
        style={{
          fontSize: 12,
          textTransform: 'uppercase',
          letterSpacing: '0.12em',
          color: props.palette.muted
        }}
      >
        {props.title}
      </div>
      <div style={{ marginTop: 10, fontSize: 24, fontWeight: 700 }}>{props.value}</div>
      <div style={{ marginTop: 8, color: props.palette.text }}>{props.detail}</div>
    </section>
  )
}
