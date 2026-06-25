import { Mic, Square } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import type {
  AppRuntimeSnapshot,
  AppSettings,
  HistoryAudioPlayback,
  MeetingStatus,
  SavedTranscript,
} from '../../shared/api-types'
import { selectVisibleTimeline } from '../../core/transcript/transcript-selectors'
import { useT } from '../i18n-context'
import { appIconProps } from '../ui/icons'
import { ArchiveAudioBar } from '../ui/archive-audio-bar'
import { EditableInlineTitle } from '../ui/editable-inline-title'
import { PageChrome } from '../ui/page-chrome'
import { RecentHistorySection, formatRecentTime } from '../ui/page-recent'

type LiveSessionSnapshot = NonNullable<AppRuntimeSnapshot['liveSession']>
type LatestContentViewportMetrics = {
  latestContentBottom: number
  viewportBottom: number
}
const AUTO_SCROLL_RESUME_THRESHOLD_PX = 48

export function LiveSessionPage(props: {
  liveSession: LiveSessionSnapshot | null
  activeRuntimeSession: LiveSessionSnapshot | null
  savedMeetingRecord: SavedTranscript | null
  sessionAudio: HistoryAudioPlayback | null
  settings: AppSettings
  busyAction: string | null
  liveSessionMessage: string | null
  meetingStartDisabled: boolean
  meetingStopDisabled: boolean
  onStartMeeting: () => void
  onStopMeeting: () => void
  onRenameSessionTitle: (id: string, title: string) => void
  onOpenHistory: () => void
  onOpenHistoryItem: (id: string) => void
  recentSessions: SavedTranscript[]
}) {
  const t = useT()
  const session = props.liveSession
  const timeline = session ? selectVisibleTimeline(session.transcript) : []
  const activeStatus = props.activeRuntimeSession?.status ?? session?.status
  const isStreaming = props.activeRuntimeSession?.status === 'streaming'
  const isSessionActive = Boolean(props.activeRuntimeSession)
  const hasTranscript = timeline.length > 0
  const transcriptRevision = session?.transcript.revision ?? 0
  const isColdStart = !session && !hasTranscript
  const sessionTitle = session ? resolveSessionTitle(session, props.savedMeetingRecord) : null
  const canEditSessionTitle = Boolean(session && !isSessionActive && props.savedMeetingRecord)
  const showSessionAudio = !isSessionActive && Boolean(props.sessionAudio)
  const displayedDurationSec = useDisplayedSessionDuration(session, activeStatus)
  const sessionActions = isSessionActive && session ? (
    <>
      <span className="session-page-header__timer">{formatSessionDuration(displayedDurationSec)}</span>
      <SessionStopButton
        busyAction={props.busyAction}
        disabled={props.meetingStopDisabled}
        onStop={props.onStopMeeting}
      />
    </>
  ) : (
    <SessionStartButton
      busyAction={props.busyAction}
      disabled={props.meetingStartDisabled}
      onStart={props.onStartMeeting}
    />
  )

  if (isColdStart) {
    return (
      <div className="page page--feature-home">
        <PageChrome title={t.navSession} subtitle={t.sessionIdleHeading} actions={sessionActions} />

        {props.liveSessionMessage ? (
          <div className="inline-note inline-note--neutral" role="status" aria-live="polite">
            {props.liveSessionMessage}
          </div>
        ) : null}

        <SessionIdleHero />

        <RecentHistorySection
          heading={t.sessionRecentHeading}
          emptyLabel={t.sessionRecentEmpty}
          viewAllLabel={t.speakViewAllHistory}
          isEmpty={props.recentSessions.length === 0}
          onViewAll={props.onOpenHistory}
        >
          {props.recentSessions.map((item) => (
            <RecentSessionRow key={item.id} item={item} onOpen={props.onOpenHistoryItem} />
          ))}
        </RecentHistorySection>
      </div>
    )
  }

  return (
    <div
      className={[
        'page',
        'page--session',
        'page--session-live',
        showSessionAudio ? 'page--session-live-with-audio' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="session-shell">
        <div className="session-shell__chrome">
          <PageChrome
            title={t.navSession}
            belowTitle={
              sessionTitle && session ? (
                <div className="session-page-header__subtitle">
                  <EditableInlineTitle
                    title={sessionTitle}
                    ariaLabel={t.archiveRenameTitle}
                    disabled={Boolean(props.busyAction)}
                    canEdit={canEditSessionTitle}
                    editButtonClassName="session-page-header__edit"
                    inputClassName="session-page-header__title-input"
                    onRename={(title) => props.onRenameSessionTitle(session.sessionId, title)}
                  />
                </div>
              ) : null
            }
            actions={sessionActions}
          />

          {props.liveSessionMessage ? (
            <div className="inline-note inline-note--neutral" role="status" aria-live="polite">
              {props.liveSessionMessage}
            </div>
          ) : null}
        </div>

        <div className="session-shell__body session-shell__body--live">
          <SessionTranscriptArea
            timeline={timeline}
            transcriptRevision={transcriptRevision}
            isStreaming={isStreaming}
            isSessionActive={isSessionActive}
          />
        </div>
      </div>

      {showSessionAudio && props.sessionAudio ? (
        <ArchiveAudioBar playback={props.sessionAudio} />
      ) : null}
    </div>
  )
}

const SESSION_IDLE_HERO = './assets/session-idle-hero.png' as const

function SessionIdleHero() {
  return (
    <section className="feature-home-hero session-idle-hero" aria-hidden="true">
      <img
        className="session-idle-hero__image"
        src={SESSION_IDLE_HERO}
        alt=""
        width={200}
        height={400}
        draggable={false}
      />
    </section>
  )
}

function RecentSessionRow(props: {
  item: SavedTranscript
  onOpen: (id: string) => void
}) {
  const t = useT()
  const timeLabel = formatRecentTime(props.item.endedAt, t)

  return (
    <button type="button" className="page-recent__link-row" onClick={() => props.onOpen(props.item.id)}>
      <span className="page-recent__link-row-time">{timeLabel}</span>
      <span className="page-recent__link-row-text">{props.item.title}</span>
    </button>
  )
}

function SessionStartButton(props: {
  busyAction: string | null
  disabled: boolean
  onStart: () => void
}) {
  const t = useT()

  return (
    <button
      type="button"
      className="session-action-btn session-action-btn--start"
      disabled={props.disabled}
      onClick={props.onStart}
    >
      <Mic {...appIconProps(16)} />
      {props.busyAction === 'meeting-start' ? t.sessionStartBusy : t.sessionStart}
    </button>
  )
}

function SessionStopButton(props: {
  busyAction: string | null
  disabled: boolean
  onStop: () => void
}) {
  const t = useT()

  return (
    <button
      type="button"
      className="session-action-btn session-action-btn--stop"
      disabled={props.disabled}
      onClick={props.onStop}
    >
      <Square {...appIconProps(12, 'session-action-btn__icon')} fill="currentColor" strokeWidth={0} />
      {props.busyAction === 'meeting-stop' ? t.sessionStopBusy : t.sessionStop}
    </button>
  )
}

function SessionTranscriptArea(props: {
  timeline: ReturnType<typeof selectVisibleTimeline>
  transcriptRevision: number
  isStreaming: boolean
  isSessionActive: boolean
}) {
  const t = useT()
  const canvasRef = useRef<HTMLElement | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const scrollContainerRef = useRef<HTMLElement | null>(null)
  const [userScrolledAway, setUserScrolledAway] = useState(false)
  const isAutoScrolling = useRef(false)
  const autoScrollReleaseTimerRef = useRef<number | null>(null)

  const clearAutoScrollReleaseTimer = useCallback(() => {
    if (autoScrollReleaseTimerRef.current === null) return
    window.clearTimeout(autoScrollReleaseTimerRef.current)
    autoScrollReleaseTimerRef.current = null
  }, [])

  useEffect(() => {
    return () => { clearAutoScrollReleaseTimer() }
  }, [clearAutoScrollReleaseTimer])

  const checkIfAtBottom = useCallback(() => {
    const container = scrollContainerRef.current
    const latestMarker = bottomRef.current
    if (!container || !latestMarker) return true
    return isLatestContentNearViewportBottom({
      latestContentBottom: latestMarker.getBoundingClientRect().bottom,
      viewportBottom: container.getBoundingClientRect().bottom
    })
  }, [])

  const releaseAutoScrolling = useCallback((delayMs: number) => {
    clearAutoScrollReleaseTimer()
    autoScrollReleaseTimerRef.current = window.setTimeout(() => {
      isAutoScrolling.current = false
      autoScrollReleaseTimerRef.current = null
      setUserScrolledAway(!checkIfAtBottom())
    }, delayMs)
  }, [checkIfAtBottom, clearAutoScrollReleaseTimer])

  const scrollLatestIntoView = useCallback((behavior: ScrollBehavior) => {
    const bottom = bottomRef.current
    if (!bottom) return
    isAutoScrolling.current = true
    bottom.scrollIntoView({ block: 'end', behavior })
    releaseAutoScrolling(behavior === 'smooth' ? 400 : 32)
  }, [releaseAutoScrolling])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const container = resolveLiveSessionScrollContainer(canvas)
    scrollContainerRef.current = container
    const handleScroll = () => {
      if (isAutoScrolling.current) return
      setUserScrolledAway(!checkIfAtBottom())
    }
    setUserScrolledAway(!checkIfAtBottom())
    container.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      container.removeEventListener('scroll', handleScroll)
      if (scrollContainerRef.current === container) scrollContainerRef.current = null
    }
  }, [checkIfAtBottom])

  useEffect(() => {
    if (!shouldAutoFollowTranscript(props.isStreaming, userScrolledAway)) return
    scrollLatestIntoView('auto')
  }, [props.transcriptRevision, props.isStreaming, scrollLatestIntoView, userScrolledAway])

  const jumpToLatest = () => {
    setUserScrolledAway(false)
    scrollLatestIntoView('smooth')
  }

  return (
    <section ref={canvasRef} className="session-transcript" aria-label="Live transcript">
      <div className="session-transcript__viewport">
        {props.timeline.length === 0 ? (
          <div className="session-transcript__empty" role="status" aria-live="polite">
            {t.sessionWaiting}
          </div>
        ) : (
          <>
            <div className="session-transcript__stack">
              {props.timeline.map((item, index) => {
                const isDraft = item.kind === 'draft'
                return (
                  <article
                    key={`${item.kind}:${item.id}`}
                    className={`session-entry ${isDraft ? 'session-entry--draft' : ''}`}
                  >
                    <div className={`session-entry__time ${isDraft ? 'session-entry__time--live' : ''}`}>
                      {formatElapsedTime(item.startedAt)}
                    </div>
                    <div className="session-entry__body">
                      <div className="session-entry__primary">
                        {item.primaryText || '...'}
                      </div>
                      {item.secondaryText ? (
                        <div className="session-entry__secondary">
                          <span className="session-entry__translate-icon" aria-hidden="true">↩</span>
                          {item.secondaryText}
                        </div>
                      ) : null}
                    </div>
                  </article>
                )
              })}
              {props.isStreaming ? (
                <div className="session-transcript__typing" aria-hidden="true">
                  <span /><span /><span />
                </div>
              ) : null}
              <div ref={bottomRef} />
            </div>

            {userScrolledAway ? (
              <div className="jump-to-latest">
                <button type="button" className="jump-to-latest__pill" onClick={jumpToLatest}>
                  {t.sessionJumpToLatest}
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </section>
  )
}

function resolveLiveSessionScrollContainer(canvas: HTMLElement): HTMLElement {
  const viewport = canvas.querySelector('.session-transcript__viewport')
  if (viewport instanceof HTMLElement) {
    return viewport
  }

  const appMain = canvas.closest('.app-main')
  if (appMain instanceof HTMLElement) {
    return appMain
  }

  return canvas
}

export function shouldAutoFollowTranscript(isStreaming: boolean, userScrolledAway: boolean): boolean {
  return isStreaming && !userScrolledAway
}

export function isLatestContentNearViewportBottom(
  metrics: LatestContentViewportMetrics,
  thresholdPx: number = AUTO_SCROLL_RESUME_THRESHOLD_PX
): boolean {
  return getDistanceFromLatestContent(metrics) < thresholdPx
}

export function getDistanceFromLatestContent(metrics: LatestContentViewportMetrics): number {
  return metrics.latestContentBottom - metrics.viewportBottom
}

function useDisplayedSessionDuration(
  session: LiveSessionSnapshot | null,
  status: MeetingStatus | undefined
): number {
  const [nowMs, setNowMs] = useState(() => Date.now())
  const isLiveTicker = shouldTickSessionDuration(status) && session?.startedAt !== null

  useEffect(() => {
    const startedAt = session?.startedAt
    if (!isLiveTicker || startedAt === null || startedAt === undefined) return

    let intervalId: number | undefined
    const updateClock = () => setNowMs(Date.now())
    const elapsedMs = Math.max(0, Date.now() - startedAt)
    const nextTickDelay = 1000 - (elapsedMs % 1000 || 1000)

    updateClock()

    const timeoutId: number = window.setTimeout(() => {
      updateClock()
      intervalId = window.setInterval(updateClock, 1000)
    }, nextTickDelay)

    return () => {
      window.clearTimeout(timeoutId)
      if (intervalId !== undefined) window.clearInterval(intervalId)
    }
  }, [isLiveTicker, session?.sessionId, session?.startedAt])

  return getDisplayedSessionDurationSec(session, status, nowMs)
}

export function getDisplayedSessionDurationSec(
  session: LiveSessionSnapshot | null,
  status: MeetingStatus | undefined,
  nowMs: number
): number {
  if (!session) return 0
  if (!shouldTickSessionDuration(status) || session.startedAt === null) return session.durationSec
  const elapsedSec = Math.max(0, Math.floor((nowMs - session.startedAt) / 1000))
  return Math.max(session.durationSec, elapsedSec)
}

function shouldTickSessionDuration(status: MeetingStatus | undefined): boolean {
  return status === 'preparing' || status === 'streaming' || status === 'recovering'
}

function formatElapsedTime(timestamp: number): string {
  const date = new Date(timestamp)
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const seconds = String(date.getSeconds()).padStart(2, '0')
  return `${hours}:${minutes}:${seconds}`
}

function formatSessionDuration(durationSec: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationSec))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export function resolveSessionTitle(
  session: LiveSessionSnapshot,
  savedRecord: SavedTranscript | null
): string | null {
  if (savedRecord?.title) {
    return savedRecord.title
  }

  return deriveSessionTitle(session)
}

function deriveSessionTitle(session: LiveSessionSnapshot): string | null {
  const firstCommitted = session.transcript.committedBlocks.find((block) => block.text.trim().length > 0)
  const firstDraft = Object.values(session.transcript.activeDrafts).find((draft) =>
    draft ? `${draft.stableText}${draft.previewText}`.trim().length > 0 : false
  )
  const sourceText = firstCommitted?.text ?? [firstDraft?.stableText, firstDraft?.previewText].filter(Boolean).join(' ')

  if (!sourceText) {
    return null
  }

  return sourceText.length > 64 ? `${sourceText.slice(0, 64).trim()}...` : sourceText
}
