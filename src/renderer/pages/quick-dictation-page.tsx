import type { AppSettings, AppRuntimeSnapshot } from '../../shared/api-types'

type Palette = {
  panel: string
  panelSoft: string
  text: string
  muted: string
  border: string
  accent: string
}

export function QuickDictationPage(props: {
  runtime: AppRuntimeSnapshot
  settings: AppSettings
  busyAction: string | null
  pttStartDisabled: boolean
  pttStopDisabled: boolean
  palette: Palette
  onStartPtt: () => void
  onStopPtt: () => void
  onCopyLatestText: () => void
  onOpenLiveSession: () => void
}) {
  const latestText = props.runtime.ptt.lastResult?.text ?? getFailedTranscriptText(props.runtime)

  return (
    <section
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1.3fr) minmax(280px, 0.7fr)',
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
        <div style={{ fontSize: 12, letterSpacing: '0.16em', textTransform: 'uppercase', color: props.palette.muted }}>
          Quick Dictation
        </div>
        <h2 style={{ margin: '10px 0 0', fontSize: 32 }}>Press, speak, deliver.</h2>
        <p style={{ margin: '10px 0 0', color: props.palette.muted, maxWidth: 560 }}>
          Keep the PTT path tight: clear readiness, obvious hotkey, fast delivery, and the latest result always visible.
        </p>

        <div
          style={{
            marginTop: 24,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 14
          }}
        >
          <StatTile label="PTT Status" value={props.runtime.ptt.status} palette={props.palette} />
          <StatTile label="Hotkey" value={props.settings.input.pttHotkey} palette={props.palette} />
          <StatTile label="Output" value={props.settings.output.method} palette={props.palette} />
        </div>

        <div style={{ marginTop: 20, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <ActionButton
            label={props.busyAction === 'ptt-start' ? 'Starting PTT...' : 'Start PTT'}
            disabled={props.pttStartDisabled}
            onClick={props.onStartPtt}
          />
          <ActionButton
            label={props.busyAction === 'ptt-stop' ? 'Stopping PTT...' : 'Stop PTT'}
            disabled={props.pttStopDisabled}
            onClick={props.onStopPtt}
          />
          <GhostButton
            label={props.busyAction === 'ptt-copy-latest' ? 'Copying...' : 'Copy Latest Text'}
            disabled={Boolean(props.busyAction) || !latestText}
            onClick={props.onCopyLatestText}
          />
          <GhostButton label="Open Live Session" onClick={props.onOpenLiveSession} />
        </div>
      </article>

      <article
        style={{
          border: `1px solid ${props.palette.border}`,
          background: props.palette.panelSoft,
          borderRadius: 28,
          padding: 24
        }}
      >
        <div style={{ fontSize: 12, letterSpacing: '0.16em', textTransform: 'uppercase', color: props.palette.muted }}>
          Latest Result
        </div>
        <div style={{ marginTop: 14, fontSize: 22, lineHeight: 1.35 }}>
          {latestText ?? 'No delivered result yet.'}
        </div>
        <div style={{ marginTop: 14, color: props.palette.muted }}>
          Delivery method: {props.runtime.ptt.lastResult?.deliveryMethod ?? props.settings.output.method}
        </div>
        {props.runtime.ptt.error?.code === 'E_OUTPUT_DELIVERY' && latestText ? (
          <div style={{ marginTop: 14, color: props.palette.muted }}>
            Delivery failed, but the transcript is preserved here so you can copy it.
          </div>
        ) : null}
      </article>
    </section>
  )
}

function getFailedTranscriptText(runtime: AppRuntimeSnapshot): string | null {
  const transcriptText = runtime.ptt.error?.detail?.transcriptText
  return typeof transcriptText === 'string' ? transcriptText : null
}

function StatTile(props: { label: string; value: string; palette: Palette }) {
  return (
    <div
      style={{
        border: `1px solid ${props.palette.border}`,
        background: props.palette.panelSoft,
        borderRadius: 20,
        padding: 16
      }}
    >
      <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.12em', color: props.palette.muted }}>
        {props.label}
      </div>
      <div style={{ marginTop: 10, fontSize: 24, fontWeight: 700, color: props.palette.text }}>{props.value}</div>
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

function GhostButton(props: { label: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      style={{
        border: '1px solid rgba(255, 255, 255, 0.12)',
        borderRadius: 999,
        padding: '12px 16px',
        background: 'transparent',
        color: 'inherit',
        cursor: props.disabled ? 'not-allowed' : 'pointer',
        opacity: props.disabled ? 0.6 : 1
      }}
    >
      {props.label}
    </button>
  )
}
