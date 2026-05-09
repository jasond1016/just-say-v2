import type { AppSettings, AppRuntimeSnapshot } from '../../shared/api-types'

export function QuickDictationPage(props: {
  runtime: AppRuntimeSnapshot
  settings: AppSettings
  busyAction: string | null
  pttStartDisabled: boolean
  pttStopDisabled: boolean
  onStartPtt: () => void
  onStopPtt: () => void
  onCopyLatestText: () => void
  onOpenLiveSession: () => void
}) {
  const latestText = props.runtime.ptt.lastResult?.text ?? getFailedTranscriptText(props.runtime)
  const isCapturing = props.runtime.ptt.status === 'capturing'
  const isProcessing =
    props.runtime.ptt.status === 'recognizing' ||
    props.runtime.ptt.status === 'post_processing' ||
    props.runtime.ptt.status === 'delivering'

  return (
    <div style={{ maxWidth: 640 }}>
      <h1 style={{ fontSize: 24, fontWeight: 600, margin: 0 }}>Quick Dictation</h1>

      <div style={{
        marginTop: 20,
        display: 'flex',
        gap: 24,
        fontSize: 13,
        color: 'var(--text-secondary)',
      }}>
        <span>
          Status:{' '}
          <span style={{
            color: isCapturing ? 'var(--accent)' : isProcessing ? 'var(--accent-text)' : 'var(--text-primary)',
            fontWeight: 500,
          }}>
            {props.runtime.ptt.status}
          </span>
        </span>
        <span>Hotkey: <strong style={{ color: 'var(--text-primary)' }}>{props.settings.input.pttHotkey}</strong></span>
        <span>Output: {props.settings.output.method}</span>
      </div>

      <div style={{ marginTop: 20, display: 'flex', gap: 8 }}>
        <PrimaryButton
          label={props.busyAction === 'ptt-start' ? 'Starting\u2026' : 'Start PTT'}
          disabled={props.pttStartDisabled}
          onClick={props.onStartPtt}
        />
        <SecondaryButton
          label={props.busyAction === 'ptt-stop' ? 'Stopping\u2026' : 'Stop PTT'}
          disabled={props.pttStopDisabled}
          onClick={props.onStopPtt}
        />
        <GhostButton
          label={props.busyAction === 'ptt-copy-latest' ? 'Copying\u2026' : 'Copy Latest'}
          disabled={Boolean(props.busyAction) || !latestText}
          onClick={props.onCopyLatestText}
        />
        <GhostButton
          label="Live Session"
          onClick={props.onOpenLiveSession}
        />
      </div>

      <hr style={{
        marginTop: 28,
        border: 'none',
        borderTop: '1px solid var(--border-subtle)',
      }} />

      <div style={{ marginTop: 24 }}>
        <div style={{
          fontSize: 12,
          fontWeight: 500,
          color: 'var(--text-tertiary)',
          letterSpacing: '0.02em',
          marginBottom: 10,
        }}>
          LATEST RESULT
        </div>
        <div style={{
          fontSize: 18,
          lineHeight: 1.55,
          color: latestText ? 'var(--text-primary)' : 'var(--text-tertiary)',
        }}>
          {latestText ?? 'No result yet. Press the hotkey to start dictation.'}
        </div>
        {latestText ? (
          <div style={{
            marginTop: 10,
            fontSize: 12,
            color: 'var(--text-tertiary)',
          }}>
            Delivered via {props.runtime.ptt.lastResult?.deliveryMethod ?? props.settings.output.method}
          </div>
        ) : null}
        {props.runtime.ptt.error?.code === 'E_OUTPUT_DELIVERY' && latestText ? (
          <div style={{
            marginTop: 8,
            fontSize: 12,
            color: 'var(--danger)',
          }}>
            Delivery failed. Transcript preserved above for manual copy.
          </div>
        ) : null}
      </div>
    </div>
  )
}

function getFailedTranscriptText(runtime: AppRuntimeSnapshot): string | null {
  const transcriptText = runtime.ptt.error?.detail?.transcriptText
  return typeof transcriptText === 'string' ? transcriptText : null
}

function PrimaryButton(props: { label: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      style={{
        border: 'none',
        borderRadius: 'var(--radius)',
        padding: '8px 16px',
        background: props.disabled ? 'var(--bg-elevated)' : 'var(--accent)',
        color: props.disabled ? 'var(--text-tertiary)' : 'var(--accent-on)',
        fontWeight: 600,
        fontSize: 13,
        cursor: props.disabled ? 'not-allowed' : 'pointer',
        fontFamily: 'inherit',
      }}
    >
      {props.label}
    </button>
  )
}

function SecondaryButton(props: { label: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      style={{
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        padding: '7px 14px',
        background: 'var(--bg-surface)',
        color: props.disabled ? 'var(--text-tertiary)' : 'var(--text-primary)',
        fontSize: 13,
        cursor: props.disabled ? 'not-allowed' : 'pointer',
        fontFamily: 'inherit',
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
        border: 'none',
        borderRadius: 'var(--radius)',
        padding: '8px 14px',
        background: 'transparent',
        color: props.disabled ? 'var(--text-tertiary)' : 'var(--text-secondary)',
        fontSize: 13,
        cursor: props.disabled ? 'not-allowed' : 'pointer',
        fontFamily: 'inherit',
      }}
    >
      {props.label}
    </button>
  )
}
