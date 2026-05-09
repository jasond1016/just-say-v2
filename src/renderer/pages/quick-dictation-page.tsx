import type { AppSettings, AppRuntimeSnapshot } from '../../shared/api-types'
import { Button } from '../ui/controls'
import { describeDeliveredVia, describeOutputMethod, describePttHotkey, describePttStatus, isPttStatusActive } from '../ui/copy'

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
  const isActive = isPttStatusActive(props.runtime.ptt.status)
  const statusLabel = describePttStatus(props.runtime.ptt.status)

  return (
    <div className="page">
      <h1 className="page-title">Quick Dictation</h1>

      <div className="inline-metadata stack-20" role="status" aria-live="polite">
        <span>
          Status:{' '}
          <span
            className={`text-weight-medium ${
              props.runtime.ptt.status === 'error'
                ? 'text-danger'
                : isActive
                  ? 'text-accent'
                  : 'text-primary'
            }`}
          >
            {statusLabel}
          </span>
        </span>
        <span>Hotkey: <strong>{describePttHotkey(props.settings.input.pttHotkey)}</strong></span>
        <span>Text delivery: {describeOutputMethod(props.settings.output.method)}</span>
      </div>

      <div className="inline-actions stack-20">
        <Button
          label={props.busyAction === 'ptt-start' ? 'Starting\u2026' : 'Start dictation'}
          disabled={props.pttStartDisabled}
          variant="primary"
          onClick={props.onStartPtt}
        />
        <Button
          label={props.busyAction === 'ptt-stop' ? 'Stopping\u2026' : 'Stop dictation'}
          disabled={props.pttStopDisabled}
          variant="secondary"
          onClick={props.onStopPtt}
        />
        <Button
          label={props.busyAction === 'ptt-copy-latest' ? 'Copying\u2026' : 'Copy latest text'}
          disabled={Boolean(props.busyAction) || !latestText}
          variant="ghost"
          onClick={props.onCopyLatestText}
        />
        <Button
          label="Open live session"
          variant="ghost"
          onClick={props.onOpenLiveSession}
        />
      </div>

      <hr className="page-rule page-rule--spacious" />

      <div className="stack-24">
        <div className="section-label">Latest Result</div>
        <div className={`lede-text ${latestText ? 'text-primary' : 'text-tertiary'}`} role="status" aria-live="polite">
          {latestText ?? 'No text yet. Start dictation to place text into the current app.'}
        </div>
        {latestText ? (
          <div className="caption-text stack-10">
            Last result was {describeDeliveredVia(props.runtime.ptt.lastResult?.deliveryMethod ?? props.settings.output.method)}.
          </div>
        ) : null}
        {props.runtime.ptt.error?.code === 'E_OUTPUT_DELIVERY' && latestText ? (
          <div className="caption-text text-danger stack-8" role="alert">
            JustSay could not send the text automatically. Your transcript is still here, so you can copy it manually.
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
