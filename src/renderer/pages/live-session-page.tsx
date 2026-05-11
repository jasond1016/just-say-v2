import { useCallback, useEffect, useRef, useState } from 'react'

import type { AppRuntimeSnapshot, AppSettings, ExportFormat, LocalServiceStatus, MeetingStatus } from '../../shared/api-types'
import { selectVisibleTimeline } from '../../core/transcript/transcript-selectors'
import { Button } from '../ui/controls'
import { describeCaptureSource } from '../ui/copy'

type LiveSessionSnapshot = NonNullable<AppRuntimeSnapshot['liveSession']>

export function LiveSessionPage(props: {
  liveSession: LiveSessionSnapshot | null
  activeRuntimeSession: LiveSessionSnapshot | null
  settings: AppSettings
  busyAction: string | null
  liveSessionMessage: string | null
  localServiceStatus: LocalServiceStatus
  meetingStartDisabled: boolean
  meetingStopDisabled: boolean
  onStartMeeting: () => void
  onStopMeeting: () => void
  onCopyLiveSession: () => void
  onExportLiveSession: (format: ExportFormat) => void
  onOpenHistory: () => void
}) {
  const session = props.liveSession
  const timeline = session ? selectVisibleTimeline(session.transcript) : []
  const activeStatus = props.activeRuntimeSession?.status ?? session?.status
  const isStreaming = props.activeRuntimeSession?.status === 'streaming'
  const isSessionActive = Boolean(props.activeRuntimeSession)
  const hasTranscript = timeline.length > 0
  const isColdStart = !session && !hasTranscript
  const statusCopy = describeStatus(activeStatus, hasTranscript)
  const sessionTitle = session ? deriveSessionTitle(session) : 'Live Session'
  const sourceSummary = props.settings.input.includeMicrophoneInMeeting ? 'System audio + microphone' : 'System audio only'
  const translationSummary = session?.translationEnabled ? 'Bilingual transcript on' : 'Original language only'
  const canUsePostActions = Boolean(session) && !isSessionActive && hasTranscript && !props.busyAction

  if (isColdStart) {
    const serviceReady = props.localServiceStatus === 'healthy' || props.localServiceStatus === 'starting'
    const serviceDotClass = serviceReady ? 'cold-start__status-dot--ready'
      : props.localServiceStatus === 'degraded' ? 'cold-start__status-dot--degraded'
      : 'cold-start__status-dot--failed'
    const serviceText = serviceReady ? 'Recognition service connected'
      : props.localServiceStatus === 'degraded' ? 'Recognition service degraded'
      : 'Recognition service unavailable'

    return (
      <div className="page page--wide">
        <section className="transcript-canvas">
          <div className="cold-start">
            <div className="cold-start__status">
              <span className={`cold-start__status-dot ${serviceDotClass}`} />
              {serviceText}
            </div>
            <h1 className="cold-start__headline">Ready to record</h1>
            <p className="cold-start__body">
              Capture system audio and transcribe in real time.
            </p>
            <div className="cold-start__sources">
              <span className="cold-start__source">System audio</span>
              {props.settings.input.includeMicrophoneInMeeting ? (
                <span className="cold-start__source">Microphone</span>
              ) : null}
            </div>
            <div className="cold-start__actions">
              <Button
                label={props.busyAction === 'meeting-start' ? 'Starting...' : 'Start session'}
                disabled={props.meetingStartDisabled}
                variant="primary"
                onClick={props.onStartMeeting}
              />
            </div>
          </div>
        </section>
      </div>
    )
  }

  return (
    <div className="page page--wide">
      <header className="surface-header surface-header--session">
        <div className="surface-header__eyebrow">Live Session</div>
        <div className="surface-header__row">
          <div className="surface-header__headline-group">
            <h1 className="surface-header__title">
              {isStreaming || !session ? 'Live Session' : sessionTitle}
            </h1>
            {!isStreaming && session ? <span className="surface-header__chip">Review</span> : null}
          </div>
          {session ? (
            <div className={`surface-header__time surface-header__time--${describeTimeTone(activeStatus)}`}>
              {formatSessionDuration(session.durationSec)}
            </div>
          ) : null}
        </div>
        <p className="surface-header__body">{statusCopy.description}</p>
        <div className="session-facts">
          <div className="session-facts__item">
            <span className="session-facts__label">Capture</span>
            <span className="session-facts__value">{sourceSummary}</span>
          </div>
          <div className="session-facts__item">
            <span className="session-facts__label">Output</span>
            <span className="session-facts__value">{translationSummary}</span>
          </div>
          <div className="session-facts__item">
            <span className="session-facts__label">State</span>
            <span className="session-facts__value">{statusCopy.title}</span>
          </div>
        </div>
      </header>

      {props.liveSessionMessage ? (
        <div className="inline-note inline-note--neutral" role="status" aria-live="polite">
          {props.liveSessionMessage}
        </div>
      ) : null}

      <TranscriptWithJump
        timeline={timeline}
        isStreaming={isStreaming}
        meetingStartDisabled={props.meetingStartDisabled}
        busyAction={props.busyAction}
        onStartMeeting={props.onStartMeeting}
      />

      <footer className="session-footer">
        {isSessionActive ? (
          <div className="session-footer__actions">
            <Button
              label={props.busyAction === 'meeting-stop' ? 'Stopping...' : 'Stop session'}
              disabled={props.meetingStopDisabled}
              variant="primary"
              onClick={props.onStopMeeting}
            />
          </div>
        ) : hasTranscript ? (
          <div className="session-footer__actions">
            <Button
              label={props.busyAction === 'meeting-start' ? 'Starting...' : 'Start new session'}
              disabled={props.meetingStartDisabled}
              variant="primary"
              onClick={props.onStartMeeting}
            />
            <Button
              label={props.busyAction === 'live-session-copy' ? 'Copying...' : 'Copy transcript'}
              disabled={!canUsePostActions}
              variant="secondary"
              onClick={props.onCopyLiveSession}
            />
            <Button
              label={props.busyAction === 'live-session-export:bilingual_text' ? 'Exporting...' : 'Export bilingual'}
              disabled={!canUsePostActions}
              variant="secondary"
              onClick={() => props.onExportLiveSession('bilingual_text')}
            />
            <Button
              label="Open history"
              disabled={!canUsePostActions}
              variant="ghost"
              onClick={props.onOpenHistory}
            />
          </div>
        ) : null}

        {!isSessionActive && hasTranscript ? (
          <details className="quiet-details">
            <summary className="quiet-details__summary">
              <span>More</span>
              <span>Plain text export</span>
            </summary>
            <div className="quiet-details__body">
              <Button
                label={props.busyAction === 'live-session-export:plain_text' ? 'Exporting...' : 'Export text'}
                disabled={!canUsePostActions}
                size="small"
                onClick={() => props.onExportLiveSession('plain_text')}
              />
            </div>
          </details>
        ) : null}
      </footer>
    </div>
  )
}

function TranscriptWithJump(props: {
  timeline: ReturnType<typeof selectVisibleTimeline>
  isStreaming: boolean
  meetingStartDisabled: boolean
  busyAction: string | null
  onStartMeeting: () => void
}) {
  const canvasRef = useRef<HTMLElement | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const [userScrolledAway, setUserScrolledAway] = useState(false)
  const isAutoScrolling = useRef(false)

  const checkIfAtBottom = useCallback(() => {
    const el = canvasRef.current
    if (!el) return true
    return el.scrollHeight - el.scrollTop - el.clientHeight < 48
  }, [])

  useEffect(() => {
    const el = canvasRef.current
    if (!el) return

    const handleScroll = () => {
      if (isAutoScrolling.current) return
      setUserScrolledAway(!checkIfAtBottom())
    }

    el.addEventListener('scroll', handleScroll, { passive: true })
    return () => el.removeEventListener('scroll', handleScroll)
  }, [checkIfAtBottom])

  useEffect(() => {
    if (userScrolledAway || !props.isStreaming) return

    const el = canvasRef.current
    if (!el) return

    isAutoScrolling.current = true
    el.scrollTop = el.scrollHeight
    requestAnimationFrame(() => {
      isAutoScrolling.current = false
    })
  }, [props.timeline.length, props.isStreaming, userScrolledAway])

  const jumpToLatest = () => {
    const el = canvasRef.current
    if (!el) return
    isAutoScrolling.current = true
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    setUserScrolledAway(false)
    setTimeout(() => { isAutoScrolling.current = false }, 400)
  }

  return (
    <section
      ref={canvasRef}
      className="transcript-canvas"
      aria-label="Live transcript"
    >
      {props.timeline.length === 0 ? (
        <div className="empty-state" role="status" aria-live="polite">
          <div className="empty-state__title">No transcript yet.</div>
          <p className="empty-state__body">
            Start a session when you need a reading surface that stays with the text from the first line through review.
          </p>
          <div className="empty-state__actions">
            <Button
              label={props.busyAction === 'meeting-start' ? 'Starting...' : 'Start session'}
              disabled={props.meetingStartDisabled}
              variant="primary"
              onClick={props.onStartMeeting}
            />
          </div>
        </div>
      ) : (
        <>
          <div className="transcript-stack">
            {props.timeline.map((item) => (
              <article
                key={`${item.kind}:${item.id}`}
                className={`transcript-entry ${item.kind === 'draft' ? 'transcript-entry--draft' : ''}`}
              >
                <div className="transcript-entry__time">{formatClockTime(item.startedAt)}</div>
                <div className="transcript-entry__body">
                  <div className="transcript-entry__meta">
                    <span>{item.kind === 'draft' ? 'Draft' : 'Committed'}</span>
                    <span>{describeCaptureSource(item.source)}</span>
                    {item.kind === 'draft' ? <strong>Now hearing</strong> : null}
                  </div>
                  <div className="transcript-entry__primary">{item.primaryText || '...'}</div>
                  {item.secondaryText ? (
                    <div className="transcript-entry__secondary">{item.secondaryText}</div>
                  ) : null}
                </div>
              </article>
            ))}
            <div ref={bottomRef} />
          </div>

          {userScrolledAway ? (
            <div className="jump-to-latest">
              <button type="button" className="jump-to-latest__pill" onClick={jumpToLatest}>
                ↓ Jump to latest
              </button>
            </div>
          ) : null}
        </>
      )}
    </section>
  )
}

function deriveSessionTitle(session: LiveSessionSnapshot): string {
  const firstCommitted = session.transcript.committedBlocks.find((block) => block.text.trim().length > 0)
  const firstDraft = Object.values(session.transcript.activeDrafts).find((draft) =>
    draft ? `${draft.stableText}${draft.previewText}`.trim().length > 0 : false
  )
  const sourceText = firstCommitted?.text ?? [firstDraft?.stableText, firstDraft?.previewText].filter(Boolean).join(' ')

  if (!sourceText) {
    return 'Recent session'
  }

  return sourceText.length > 64 ? `${sourceText.slice(0, 64).trim()}...` : sourceText
}

function describeStatus(status: MeetingStatus | undefined, hasTranscript: boolean) {
  switch (status) {
    case 'preparing':
      return {
        title: 'Preparing',
        description: 'Getting the recognizer and capture path ready before the first line lands.'
      }
    case 'streaming':
      return {
        title: 'Streaming',
        description: 'Stay with the transcript. The only persistent action is stopping the session.'
      }
    case 'recovering':
      return {
        title: 'Recovering',
        description: 'JustSay is reconnecting the session without clearing the transcript you already have.'
      }
    case 'finishing':
    case 'persisting':
      return {
        title: 'Saving',
        description: 'The live session has stopped. JustSay is keeping the transcript on this canvas while it saves.'
      }
    case 'stopped_unexpectedly':
      return {
        title: 'Interrupted',
        description: hasTranscript
          ? 'The session ended unexpectedly, but the transcript stays here for review and export.'
          : 'The session ended unexpectedly before any transcript was committed.'
      }
    case 'error':
      return {
        title: 'Needs attention',
        description: hasTranscript
          ? 'The transcript is still here. Review it, then decide whether to start a fresh session.'
          : 'JustSay could not continue this session.'
      }
    case 'completed':
      return {
        title: 'Completed',
        description: 'The transcript remains in place and post-session actions move in only after capture is done.'
      }
    case 'idle':
    case undefined:
      return {
        title: 'Ready',
        description: hasTranscript
          ? 'Your latest transcript is still here for review.'
          : 'A quiet reading surface is ready when you start a session.'
      }
    default:
      return {
        title: String(status),
        description: 'Session state updated.'
      }
  }
}

function describeTimeTone(status: MeetingStatus | undefined): 'live' | 'done' | 'warning' {
  switch (status) {
    case 'streaming':
    case 'recovering':
    case 'preparing':
      return 'live'
    case 'stopped_unexpectedly':
    case 'error':
      return 'warning'
    default:
      return 'done'
  }
}

function formatClockTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

function formatSessionDuration(durationSec: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationSec))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}
