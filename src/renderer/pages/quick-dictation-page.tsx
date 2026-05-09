import type { AppSettings, AppRuntimeSnapshot } from '../../shared/api-types'
import { Button } from '../ui/controls'

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
    <div className="page">
      <h1 className="page-title">Quick Dictation</h1>

      <div className="inline-metadata stack-20">
        <span>
          Status:{' '}
          <span
            className={`text-weight-medium ${
              isCapturing
                ? 'text-accent'
                : isProcessing
                  ? 'text-accent'
                  : 'text-primary'
            }`}
          >
            {props.runtime.ptt.status}
          </span>
        </span>
        <span>Hotkey: <strong>{props.settings.input.pttHotkey}</strong></span>
        <span>Output: {props.settings.output.method}</span>
      </div>

      <div className="inline-actions stack-20">
        <Button
          label={props.busyAction === 'ptt-start' ? 'Starting\u2026' : 'Start PTT'}
          disabled={props.pttStartDisabled}
          variant="primary"
          onClick={props.onStartPtt}
        />
        <Button
          label={props.busyAction === 'ptt-stop' ? 'Stopping\u2026' : 'Stop PTT'}
          disabled={props.pttStopDisabled}
          variant="secondary"
          onClick={props.onStopPtt}
        />
        <Button
          label={props.busyAction === 'ptt-copy-latest' ? 'Copying\u2026' : 'Copy Latest'}
          disabled={Boolean(props.busyAction) || !latestText}
          variant="ghost"
          onClick={props.onCopyLatestText}
        />
        <Button
          label="Live Session"
          variant="ghost"
          onClick={props.onOpenLiveSession}
        />
      </div>

      <hr className="page-rule page-rule--spacious" />

      <div className="stack-24">
        <div className="section-label">Latest Result</div>
        <div className={`lede-text ${latestText ? 'text-primary' : 'text-tertiary'}`}>
          {latestText ?? 'No result yet. Press the hotkey to start dictation.'}
        </div>
        {latestText ? (
          <div className="caption-text stack-10">
            Delivered via {props.runtime.ptt.lastResult?.deliveryMethod ?? props.settings.output.method}
          </div>
        ) : null}
        {props.runtime.ptt.error?.code === 'E_OUTPUT_DELIVERY' && latestText ? (
          <div className="caption-text text-danger stack-8">
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
