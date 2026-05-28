import { useCallback, useEffect, useRef, useState } from 'react'

import type { AppRuntimeSnapshot, AppSettings, ExportFormat, MeetingStatus } from '../../shared/api-types'
import { selectVisibleTimeline } from '../../core/transcript/transcript-selectors'

type LiveSessionSnapshot = NonNullable<AppRuntimeSnapshot['liveSession']>
type LatestContentViewportMetrics = {
  latestContentBottom: number
  viewportBottom: number
}
const AUTO_SCROLL_RESUME_THRESHOLD_PX = 48

export function LiveSessionPage(props: {
  liveSession: LiveSessionSnapshot | null
  activeRuntimeSession: LiveSessionSnapshot | null
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
  const session = props.liveSession
  const timeline = session ? selectVisibleTimeline(session.transcript) : []
  const activeStatus = props.activeRuntimeSession?.status ?? session?.status
  const isStreaming = props.activeRuntimeSession?.status === 'streaming'
  const isSessionActive = Boolean(props.activeRuntimeSession)
  const hasTranscript = timeline.length > 0
  const transcriptRevision = session?.transcript.revision ?? 0
  const isColdStart = !session && !hasTranscript
  const sessionTitle = session ? deriveSessionTitle(session) : null
  const displayedDurationSec = useDisplayedSessionDuration(session, activeStatus)
  const canUsePostActions = Boolean(session) && !isSessionActive && hasTranscript && !props.busyAction

  return (
    <div className="page page--session">
      <header className="session-page-header">
        <div className="session-page-header__left">
          <h1 className="page-title">Session</h1>
          {!isColdStart && sessionTitle ? (
            <div className="session-page-header__subtitle">
              <span>{sessionTitle}</span>
              <button type="button" className="session-page-header__edit" aria-label="Edit title">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M11.5 2.5l2 2-8 8H3.5v-2l8-8z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
          ) : null}
        </div>
        <div className="session-page-header__right">
          {isSessionActive && session ? (
            <>
              <span className="session-page-header__timer">{formatSessionDuration(displayedDurationSec)}</span>
              <button
                type="button"
                className="session-action-btn session-action-btn--stop"
                disabled={props.meetingStopDisabled}
                onClick={props.onStopMeeting}
              >
                <span className="session-action-btn__icon session-action-btn__icon--stop" aria-hidden="true" />
                {props.busyAction === 'meeting-stop' ? '停止中...' : '停止转录'}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="session-action-btn session-action-btn--start"
              disabled={props.meetingStartDisabled}
              onClick={props.onStartMeeting}
            >
              <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="M10 1a3.5 3.5 0 0 0-3.5 3.5v5a3.5 3.5 0 1 0 7 0v-5A3.5 3.5 0 0 0 10 1Z" fill="currentColor" />
                <path d="M5 8.5a.75.75 0 0 0-1.5 0v1a6.5 6.5 0 0 0 5.75 6.46v2.29a.75.75 0 0 0 1.5 0v-2.29A6.5 6.5 0 0 0 16.5 9.5v-1a.75.75 0 0 0-1.5 0v1a5 5 0 0 1-10 0v-1Z" fill="currentColor" />
              </svg>
              {props.busyAction === 'meeting-start' ? '开始中...' : '开始转录'}
            </button>
          )}
        </div>
      </header>

      {props.liveSessionMessage ? (
        <div className="inline-note inline-note--neutral" role="status" aria-live="polite">
          {props.liveSessionMessage}
        </div>
      ) : null}

      {isColdStart ? (
        <SessionIdleState />
      ) : (
        <SessionTranscriptArea
          timeline={timeline}
          transcriptRevision={transcriptRevision}
          isStreaming={isStreaming}
          isSessionActive={isSessionActive}
          hasTranscript={hasTranscript}
          canUsePostActions={canUsePostActions}
          busyAction={props.busyAction}
          meetingStartDisabled={props.meetingStartDisabled}
          onStartMeeting={props.onStartMeeting}
          onCopyLiveSession={props.onCopyLiveSession}
          onExportLiveSession={props.onExportLiveSession}
          onOpenHistory={props.onOpenHistory}
        />
      )}
    </div>
  )
}

function SessionIdleState() {
  return (
    <section className="session-idle" aria-label="Session idle">
      <div className="session-idle__illustration" aria-hidden="true">
        <svg width="120" height="120" viewBox="0 0 120 120" fill="none">
          <circle cx="60" cy="60" r="50" fill="oklch(0.94 0.03 40)" />
          <rect x="42" y="30" width="18" height="46" rx="9" fill="oklch(0.72 0.1 40)" />
          <path d="M35 58a25 25 0 0 0 50 0" stroke="oklch(0.72 0.1 40)" strokeWidth="3" strokeLinecap="round" fill="none" />
          <line x1="60" y1="83" x2="60" y2="96" stroke="oklch(0.72 0.1 40)" strokeWidth="3" strokeLinecap="round" />
          <rect x="68" y="36" width="22" height="5" rx="2.5" fill="oklch(0.82 0.06 40)" />
          <rect x="68" y="45" width="18" height="5" rx="2.5" fill="oklch(0.82 0.06 40)" />
          <rect x="68" y="54" width="14" height="5" rx="2.5" fill="oklch(0.82 0.06 40)" />
        </svg>
      </div>
      <h2 className="session-idle__heading">点击开始转录，自动生成会议内容</h2>
      <ul className="session-idle__features">
        <li className="session-idle__feature">
          <span className="session-idle__feature-icon" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none"><path d="M10 2a4 4 0 0 0-4 4v1h-.5A2.5 2.5 0 0 0 3 9.5v5A2.5 2.5 0 0 0 5.5 17h9a2.5 2.5 0 0 0 2.5-2.5v-5A2.5 2.5 0 0 0 14.5 7H14V6a4 4 0 0 0-4-4Zm2 5V6a2 2 0 1 0-4 0v1h4Z" fill="currentColor" /></svg>
          </span>
          自动识别说话人
        </li>
        <li className="session-idle__feature">
          <span className="session-idle__feature-icon" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none"><path d="M3 4.5A2.5 2.5 0 0 1 5.5 2h9A2.5 2.5 0 0 1 17 4.5v11a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 3 15.5v-11ZM6 6h8v1.5H6V6Zm0 3.5h5V11H6V9.5Z" fill="currentColor" /></svg>
          </span>
          实时生成双语转录
        </li>
        <li className="session-idle__feature">
          <span className="session-idle__feature-icon" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none"><path fillRule="evenodd" clipRule="evenodd" d="M4 3a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2H4Zm2 4h8v1.5H6V7Zm0 3.5h5V12H6v-1.5Z" fill="currentColor" /></svg>
          </span>
          转录内容会自动保存在本次 Session 中
        </li>
      </ul>
      <div className="session-idle__hint">
        <span className="session-idle__hint-icon" aria-hidden="true">✦</span>
        开始后将自动滚动显示最新转录内容
      </div>
    </section>
  )
}

function SessionTranscriptArea(props: {
  timeline: ReturnType<typeof selectVisibleTimeline>
  transcriptRevision: number
  isStreaming: boolean
  isSessionActive: boolean
  hasTranscript: boolean
  canUsePostActions: boolean
  busyAction: string | null
  meetingStartDisabled: boolean
  onStartMeeting: () => void
  onCopyLiveSession: () => void
  onExportLiveSession: (format: ExportFormat) => void
  onOpenHistory: () => void
}) {
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
      {props.timeline.length === 0 ? (
        <div className="session-transcript__empty" role="status" aria-live="polite">
          等待转录内容...
        </div>
      ) : (
        <>
          <div className="session-transcript__stack">
            {props.timeline.map((item, index) => {
              const isLast = index === props.timeline.length - 1
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
                ↓ 跳到最新
              </button>
            </div>
          ) : null}
        </>
      )}

      {!props.isSessionActive && props.hasTranscript ? (
        <footer className="session-transcript__footer">
          <button
            type="button"
            className="session-action-btn session-action-btn--start"
            disabled={props.meetingStartDisabled}
            onClick={props.onStartMeeting}
          >
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="M10 1a3.5 3.5 0 0 0-3.5 3.5v5a3.5 3.5 0 1 0 7 0v-5A3.5 3.5 0 0 0 10 1Z" fill="currentColor" />
              <path d="M5 8.5a.75.75 0 0 0-1.5 0v1a6.5 6.5 0 0 0 5.75 6.46v2.29a.75.75 0 0 0 1.5 0v-2.29A6.5 6.5 0 0 0 16.5 9.5v-1a.75.75 0 0 0-1.5 0v1a5 5 0 0 1-10 0v-1Z" fill="currentColor" />
            </svg>
            {props.busyAction === 'meeting-start' ? '开始中...' : '开始新转录'}
          </button>
          <button
            type="button"
            className="button button--secondary button--small"
            disabled={!props.canUsePostActions}
            onClick={props.onCopyLiveSession}
          >
            {props.busyAction === 'live-session-copy' ? '复制中...' : '复制文本'}
          </button>
          <button
            type="button"
            className="button button--ghost button--small"
            disabled={!props.canUsePostActions}
            onClick={props.onOpenHistory}
          >
            查看历史
          </button>
        </footer>
      ) : null}
    </section>
  )
}

function resolveLiveSessionScrollContainer(canvas: HTMLElement): HTMLElement {
  const appMain = canvas.closest('.app-main')
  if (appMain instanceof HTMLElement) return appMain
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
