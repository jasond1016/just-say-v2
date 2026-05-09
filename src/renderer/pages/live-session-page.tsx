import type { AppSettings, AppRuntimeSnapshot, ExportFormat, MeetingStatus } from '../../shared/api-types'
import { formatDuration } from '../app/app-model'
import { selectLiveSessionTimeline } from '../features/runtime/runtime-selectors'
import { Button } from '../ui/controls'

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

      <div className="status-strip stack-16">
        <StatusDot active={isStreaming} />
        <span className="status-strip__title">{status.title}</span>
        <span className="text-tertiary">{status.description}</span>
      </div>

      {props.liveSessionMessage ? (
        <div className="caption-text stack-8">
          {props.liveSessionMessage}
        </div>
      ) : null}

      <div className="inline-actions stack-16">
        <Button
          label={props.busyAction === 'meeting-start' ? 'Starting\u2026' : 'Start Meeting'}
          disabled={props.meetingStartDisabled}
          variant="primary"
          onClick={props.onStartMeeting}
        />
        <Button
          label={props.busyAction === 'meeting-stop' ? 'Stopping\u2026' : 'Stop Meeting'}
          disabled={props.meetingStopDisabled}
          variant="secondary"
          onClick={props.onStopMeeting}
        />
        <Button
          label={props.busyAction === 'live-session-copy' ? 'Copying\u2026' : 'Copy'}
          disabled={!canAct}
          variant="ghost"
          onClick={props.onCopyLiveSession}
        />
        <Button
          label={props.busyAction === 'live-session-export:plain_text' ? 'Exporting\u2026' : 'Export Text'}
          disabled={!canAct}
          variant="ghost"
          onClick={() => props.onExportLiveSession('plain_text')}
        />
        <Button
          label={props.busyAction === 'live-session-export:bilingual_text' ? 'Exporting\u2026' : 'Export Bilingual'}
          disabled={!canAct}
          variant="ghost"
          onClick={() => props.onExportLiveSession('bilingual_text')}
        />
        <Button
          label="History"
          variant="ghost"
          onClick={props.onOpenHistory}
        />
      </div>

      <hr className="page-rule" />

      <div className="stack-20">
        {timeline.length === 0 ? (
          <div className="text-tertiary">
            No transcript blocks yet. Start a meeting to see live text here.
          </div>
        ) : (
          <div className="timeline">
            {timeline.map((item) => (
              <div key={`${item.kind}:${item.id}`} className="timeline-row">
                <div className="timeline-row__eyebrow">
                  <span className={item.kind === 'draft' ? 'text-accent' : 'text-tertiary'}>
                    {item.kind}
                  </span>
                  <span>{item.source}</span>
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
