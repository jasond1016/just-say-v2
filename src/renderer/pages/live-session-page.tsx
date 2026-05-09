import type { AppSettings, AppRuntimeSnapshot, ExportFormat, MeetingStatus } from '../../shared/api-types'
import { formatDuration } from '../app/app-model'
import { selectLiveSessionTimeline } from '../features/runtime/runtime-selectors'
import { Button } from '../ui/controls'
import { describeCaptureSource, describeTimelineKind } from '../ui/copy'

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
    <div className="page">
      <div className="page-header page-header--wide">
        <h1 className="page-title">Live Session</h1>
        {liveSession ? (
          <span className={`mono-data ${isStreaming ? 'text-accent' : 'text-secondary'}`}>
            {formatDuration(liveSession.durationSec)}
          </span>
        ) : null}
      </div>

      <div className="status-strip stack-16" role="status" aria-live="polite">
        <StatusDot active={isStreaming} />
        <span className="status-strip__title">{status.title}</span>
        <span className="text-tertiary">{status.description}</span>
      </div>

      {props.liveSessionMessage ? (
        <div className="caption-text stack-8" role="status" aria-live="polite">
          {props.liveSessionMessage}
        </div>
      ) : null}

      <div className="action-block stack-20">
        <div className="action-row">
          <Button
            label={props.busyAction === 'meeting-start' ? 'Starting\u2026' : 'Start session'}
            disabled={props.meetingStartDisabled}
            variant="primary"
            onClick={props.onStartMeeting}
          />
          <Button
            label={props.busyAction === 'meeting-stop' ? 'Stopping\u2026' : 'Stop session'}
            disabled={props.meetingStopDisabled}
            variant="secondary"
            onClick={props.onStopMeeting}
          />
          <Button
            label={props.busyAction === 'live-session-copy' ? 'Copying\u2026' : 'Copy transcript'}
            disabled={!canAct}
            variant="secondary"
            onClick={props.onCopyLiveSession}
          />
          <Button
            label="Open history"
            disabled={!canAct}
            variant="ghost"
            onClick={props.onOpenHistory}
          />
        </div>

        <details className="action-disclosure" open={Boolean(props.liveSessionMessage)}>
          <summary className="action-disclosure__summary">
            <span className="action-disclosure__title">Export</span>
            <span className="action-disclosure__meta">Text or bilingual text</span>
          </summary>
          <div className="action-disclosure__body">
            <Button
              label={props.busyAction === 'live-session-export:plain_text' ? 'Exporting\u2026' : 'Export text'}
              disabled={!canAct}
              size="small"
              onClick={() => props.onExportLiveSession('plain_text')}
            />
            <Button
              label={props.busyAction === 'live-session-export:bilingual_text' ? 'Exporting\u2026' : 'Export bilingual'}
              disabled={!canAct}
              size="small"
              onClick={() => props.onExportLiveSession('bilingual_text')}
            />
          </div>
        </details>
      </div>

      <hr className="page-rule" />

      <div className="stack-20">
        {timeline.length === 0 ? (
          <div className="text-tertiary" role="status" aria-live="polite">
            No transcript yet. Start a session to see live text here.
          </div>
        ) : (
          <div className="timeline">
            {timeline.map((item) => (
              <div key={`${item.kind}:${item.id}`} className="timeline-row">
                <div className="timeline-row__eyebrow">
                  <span className={item.kind === 'draft' ? 'text-accent' : 'text-tertiary'}>
                    {describeTimelineKind(item.kind)}
                  </span>
                  <span>{describeCaptureSource(item.source)}</span>
                </div>
                <div
                  className={`timeline-row__body ${
                    item.kind === 'draft' ? 'timeline-row__body--draft' : 'timeline-row__body--committed'
                  }`}
                >
                  {item.primaryText || '\u2026'}
                </div>
                {item.secondaryText ? (
                  <div className="timeline-row__secondary">
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
  return <span className={`status-dot ${props.active ? 'status-dot--active' : ''}`} />
}

function describeStatus(status: MeetingStatus | undefined) {
  switch (status) {
    case 'preparing':
      return { title: 'Preparing', description: 'Getting the recognizer and audio capture ready.' }
    case 'streaming':
      return { title: 'Streaming', description: 'Live transcript active.' }
    case 'recovering':
      return { title: 'Recovering', description: 'Reconnecting without ending the session.' }
    case 'finishing':
      return { title: 'Finishing', description: 'Saving the last few lines.' }
    case 'persisting':
      return { title: 'Saving', description: 'Writing this session to history.' }
    case 'stopped_unexpectedly':
      return { title: 'Stopped', description: 'The session ended unexpectedly. Check the latest note above.' }
    case 'completed':
      return { title: 'Completed', description: 'Session finished successfully.' }
    case 'error':
      return { title: 'Error', description: 'JustSay could not recover from this issue.' }
    case 'idle':
    case undefined:
      return { title: 'Idle', description: 'No active session.' }
    default:
      return { title: String(status), description: 'Updating.' }
  }
}
