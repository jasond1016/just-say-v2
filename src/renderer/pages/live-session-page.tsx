import type { AppSettings, AppRuntimeSnapshot, ExportFormat, MeetingStatus } from '../../shared/api-types'
import { formatDuration } from '../app/app-model'
import { selectLiveSessionTimeline } from '../features/runtime/runtime-selectors'

export function LiveSessionPage(props: {
  runtime: AppRuntimeSnapshot
  settings: AppSettings
  busyAction: string | null
  liveSessionMessage: string | null
  meetingStartDisabled: boolean
  meetingStopDisabled: boolean
  onStartMeeting: () => void
  onStopMeeting: () => void
  onCopyLiveSession: () => void
  onExportLiveSession: (format: ExportFormat) => void
  onOpenHistory: () => void
}) {
  const liveSession = props.runtime.liveSession
  const timeline = selectLiveSessionTimeline(props.runtime)
  const status = describeStatus(liveSession?.status)
  const canAct = Boolean(liveSession) && !props.busyAction
  const isStreaming = liveSession?.status === 'streaming'

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
        <h1 style={{ fontSize: 24, fontWeight: 600, margin: 0 }}>Live Session</h1>
        {liveSession ? (
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 14,
            fontVariantNumeric: 'tabular-nums',
            color: isStreaming ? 'var(--accent)' : 'var(--text-secondary)',
          }}>
            {formatDuration(liveSession.durationSec)}
          </span>
        ) : null}
      </div>

      <div style={{
        marginTop: 16,
        padding: '10px 14px',
        background: 'var(--bg-surface)',
        borderRadius: 'var(--radius)',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        fontSize: 13,
      }}>
        <StatusDot active={isStreaming} />
        <span style={{ fontWeight: 500 }}>{status.title}</span>
        <span style={{ color: 'var(--text-tertiary)' }}>{status.description}</span>
      </div>

      {props.liveSessionMessage ? (
        <div style={{
          marginTop: 8,
          fontSize: 12,
          color: 'var(--text-tertiary)',
          padding: '0 2px',
        }}>
          {props.liveSessionMessage}
        </div>
      ) : null}

      <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
        <PrimaryButton
          label={props.busyAction === 'meeting-start' ? 'Starting\u2026' : 'Start Meeting'}
          disabled={props.meetingStartDisabled}
          onClick={props.onStartMeeting}
        />
        <SecondaryButton
          label={props.busyAction === 'meeting-stop' ? 'Stopping\u2026' : 'Stop Meeting'}
          disabled={props.meetingStopDisabled}
          onClick={props.onStopMeeting}
        />
        <GhostButton
          label={props.busyAction === 'live-session-copy' ? 'Copying\u2026' : 'Copy'}
          disabled={!canAct}
          onClick={props.onCopyLiveSession}
        />
        <GhostButton
          label={props.busyAction === 'live-session-export:plain_text' ? 'Exporting\u2026' : 'Export Text'}
          disabled={!canAct}
          onClick={() => props.onExportLiveSession('plain_text')}
        />
        <GhostButton
          label={props.busyAction === 'live-session-export:bilingual_text' ? 'Exporting\u2026' : 'Export Bilingual'}
          disabled={!canAct}
          onClick={() => props.onExportLiveSession('bilingual_text')}
        />
        <GhostButton
          label="History"
          onClick={props.onOpenHistory}
        />
      </div>

      <hr style={{ marginTop: 24, border: 'none', borderTop: '1px solid var(--border-subtle)' }} />

      <div style={{ marginTop: 20 }}>
        {timeline.length === 0 ? (
          <div style={{ color: 'var(--text-tertiary)', fontSize: 14 }}>
            No transcript blocks yet. Start a meeting to see live text here.
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 2 }}>
            {timeline.map((item) => (
              <div
                key={`${item.kind}:${item.id}`}
                style={{
                  padding: '10px 0',
                  borderBottom: '1px solid var(--border-subtle)',
                }}
              >
                <div style={{
                  fontSize: 11,
                  color: 'var(--text-tertiary)',
                  marginBottom: 4,
                  display: 'flex',
                  gap: 8,
                }}>
                  <span style={{
                    color: item.kind === 'draft' ? 'var(--accent-text)' : 'var(--text-tertiary)',
                  }}>
                    {item.kind}
                  </span>
                  <span>{item.source}</span>
                </div>
                <div style={{
                  fontSize: 15,
                  lineHeight: 1.55,
                  color: item.kind === 'draft' ? 'var(--text-secondary)' : 'var(--text-primary)',
                }}>
                  {item.primaryText || '\u2026'}
                </div>
                {item.secondaryText ? (
                  <div style={{
                    marginTop: 4,
                    fontSize: 14,
                    lineHeight: 1.5,
                    color: 'var(--text-tertiary)',
                  }}>
                    {item.secondaryText}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function StatusDot(props: { active: boolean }) {
  return (
    <span style={{
      display: 'inline-block',
      width: 8,
      height: 8,
      borderRadius: '50%',
      background: props.active ? 'var(--success)' : 'var(--text-tertiary)',
      animation: props.active ? 'pulse 2s ease-in-out infinite' : 'none',
      flexShrink: 0,
    }} />
  )
}

function describeStatus(status: MeetingStatus | undefined) {
  switch (status) {
    case 'preparing':
      return { title: 'Preparing', description: 'Warming up engine and capture source.' }
    case 'streaming':
      return { title: 'Streaming', description: 'Live transcript active.' }
    case 'recovering':
      return { title: 'Recovering', description: 'Rebuilding engine, session alive.' }
    case 'finishing':
      return { title: 'Finishing', description: 'Finalizing last recognition blocks.' }
    case 'persisting':
      return { title: 'Saving', description: 'Persisting to history.' }
    case 'stopped_unexpectedly':
      return { title: 'Stopped', description: 'Unexpected stop. Check notifications.' }
    case 'completed':
      return { title: 'Completed', description: 'Session finished successfully.' }
    case 'error':
      return { title: 'Error', description: 'Unrecoverable error.' }
    case 'idle':
    case undefined:
      return { title: 'Idle', description: 'No active session.' }
    default:
      return { title: String(status), description: 'Updating.' }
  }
}

function PrimaryButton(props: { label: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={props.onClick} disabled={props.disabled} style={{
      border: 'none',
      borderRadius: 'var(--radius)',
      padding: '8px 16px',
      background: props.disabled ? 'var(--bg-elevated)' : 'var(--accent)',
      color: props.disabled ? 'var(--text-tertiary)' : 'var(--accent-on)',
      fontWeight: 600,
      fontSize: 13,
      cursor: props.disabled ? 'not-allowed' : 'pointer',
      fontFamily: 'inherit',
    }}>
      {props.label}
    </button>
  )
}

function SecondaryButton(props: { label: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={props.onClick} disabled={props.disabled} style={{
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius)',
      padding: '7px 14px',
      background: 'var(--bg-surface)',
      color: props.disabled ? 'var(--text-tertiary)' : 'var(--text-primary)',
      fontSize: 13,
      cursor: props.disabled ? 'not-allowed' : 'pointer',
      fontFamily: 'inherit',
    }}>
      {props.label}
    </button>
  )
}

function GhostButton(props: { label: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={props.onClick} disabled={props.disabled} style={{
      border: 'none',
      borderRadius: 'var(--radius)',
      padding: '8px 14px',
      background: 'transparent',
      color: props.disabled ? 'var(--text-tertiary)' : 'var(--text-secondary)',
      fontSize: 13,
      cursor: props.disabled ? 'not-allowed' : 'pointer',
      fontFamily: 'inherit',
    }}>
      {props.label}
    </button>
  )
}
