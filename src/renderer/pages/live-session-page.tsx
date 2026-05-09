import type { AppSettings, AppRuntimeSnapshot } from '../../shared/api-types'
import { buildTranscriptTimeline, formatDuration } from '../app/app-model'

type Palette = {
  panel: string
  panelSoft: string
  text: string
  muted: string
  border: string
}

export function LiveSessionPage(props: {
  runtime: AppRuntimeSnapshot
  settings: AppSettings
  busyAction: string | null
  meetingStartDisabled: boolean
  meetingStopDisabled: boolean
  palette: Palette
  onStartMeeting: () => void
  onStopMeeting: () => void
  onOpenHistory: () => void
}) {
  const liveSession = props.runtime.liveSession
  const timeline = liveSession ? buildTranscriptTimeline(liveSession.transcript) : []

  return (
    <section
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1.4fr) minmax(280px, 0.6fr)',
        gap: 20
      }}
    >
      <article
        style={{
          border: `1px solid ${props.palette.border}`,
          background: props.palette.panel,
          borderRadius: 28,
          padding: 24
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 12, letterSpacing: '0.16em', textTransform: 'uppercase', color: props.palette.muted }}>
              Live Session
            </div>
            <h2 style={{ margin: '10px 0 0', fontSize: 32 }}>
              {liveSession ? `Status: ${liveSession.status}` : 'Start a meeting transcript'}
            </h2>
          </div>
          <div style={{ color: props.palette.muted, fontSize: 14 }}>
            {liveSession ? formatDuration(liveSession.durationSec) : '00:00'}
          </div>
        </div>

        <div style={{ marginTop: 18, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <ActionButton
            label={props.busyAction === 'meeting-start' ? 'Starting meeting...' : 'Start Meeting'}
            disabled={props.meetingStartDisabled}
            onClick={props.onStartMeeting}
          />
          <ActionButton
            label={props.busyAction === 'meeting-stop' ? 'Stopping meeting...' : 'Stop Meeting'}
            disabled={props.meetingStopDisabled}
            onClick={props.onStopMeeting}
          />
          <GhostButton label="Open History" onClick={props.onOpenHistory} />
        </div>

        <div style={{ marginTop: 22, display: 'grid', gap: 14 }}>
          {timeline.length === 0 ? (
            <div style={{ color: props.palette.muted }}>
              No transcript blocks yet. Once the session is streaming, committed text and drafts will land here.
            </div>
          ) : (
            timeline.map((item) => (
              <article
                key={`${item.kind}:${item.id}`}
                style={{
                  border: `1px solid ${props.palette.border}`,
                  background: item.kind === 'draft' ? 'rgba(255, 255, 255, 0.02)' : props.palette.panelSoft,
                  borderRadius: 18,
                  padding: 16
                }}
              >
                <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.12em', color: props.palette.muted }}>
                  {item.kind} • {item.source}
                </div>
                <div style={{ marginTop: 10, fontSize: 18, lineHeight: 1.45 }}>{item.primaryText || '...'}</div>
                {item.secondaryText ? (
                  <div style={{ marginTop: 8, color: props.palette.muted, lineHeight: 1.45 }}>{item.secondaryText}</div>
                ) : null}
              </article>
            ))
          )}
        </div>
      </article>

      <article
        style={{
          border: `1px solid ${props.palette.border}`,
          background: props.palette.panelSoft,
          borderRadius: 28,
          padding: 24,
          display: 'grid',
          gap: 14,
          alignContent: 'start'
        }}
      >
        <SidebarStat label="Profile" value={props.settings.speech.selectedProfileId} palette={props.palette} />
        <SidebarStat label="Language" value={props.settings.speech.language} palette={props.palette} />
        <SidebarStat
          label="Mic In Meeting"
          value={props.settings.input.includeMicrophoneInMeeting ? 'enabled' : 'disabled'}
          palette={props.palette}
        />
      </article>
    </section>
  )
}

function SidebarStat(props: { label: string; value: string; palette: Palette }) {
  return (
    <div>
      <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.12em', color: props.palette.muted }}>
        {props.label}
      </div>
      <div style={{ marginTop: 8, fontSize: 20, fontWeight: 700 }}>{props.value}</div>
    </div>
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
        padding: '12px 16px',
        background: props.disabled ? 'rgba(120, 130, 145, 0.18)' : 'rgba(22, 163, 74, 0.18)',
        color: '#f6fbff',
        cursor: props.disabled ? 'not-allowed' : 'pointer'
      }}
    >
      {props.label}
    </button>
  )
}

function GhostButton(props: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      style={{
        border: '1px solid rgba(255, 255, 255, 0.12)',
        borderRadius: 999,
        padding: '12px 16px',
        background: 'transparent',
        color: 'inherit',
        cursor: 'pointer'
      }}
    >
      {props.label}
    </button>
  )
}
