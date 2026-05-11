import { useEffect, useMemo, useState } from 'react'

import type { AppSettings, AppRuntimeSnapshot, PttStatus } from '../../shared/api-types'
import { Button } from '../ui/controls'
import { describeDeliveredVia, describeOutputMethod, describePttHotkey } from '../ui/copy'

type QuickDictationSurface = 'idle' | 'recording' | 'processing' | 'sent' | 'recovery'

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
  const latestDelivery = props.runtime.ptt.lastResult?.deliveryMethod ?? props.settings.output.method
  const deliveredAt = props.runtime.ptt.lastResult?.deliveredAt ?? null
  const [showSentFeedback, setShowSentFeedback] = useState(false)
  const [captureStartedAt, setCaptureStartedAt] = useState<number | null>(null)
  const [tick, setTick] = useState(() => Date.now())

  useEffect(() => {
    const status = props.runtime.ptt.status
    if (status === 'capturing') {
      setCaptureStartedAt((current) => current ?? Date.now())
      return
    }

    if (status !== 'arming') {
      setCaptureStartedAt(null)
    }
  }, [props.runtime.ptt.status])

  useEffect(() => {
    if (!captureStartedAt) {
      return
    }

    const intervalId = window.setInterval(() => {
      setTick(Date.now())
    }, 500)

    return () => window.clearInterval(intervalId)
  }, [captureStartedAt])

  useEffect(() => {
    if (!deliveredAt) {
      setShowSentFeedback(false)
      return
    }

    const remaining = deliveredAt + 2200 - Date.now()
    if (remaining <= 0) {
      setShowSentFeedback(false)
      return
    }

    setShowSentFeedback(true)
    const timeoutId = window.setTimeout(() => {
      setShowSentFeedback(false)
    }, remaining)

    return () => window.clearTimeout(timeoutId)
  }, [deliveredAt])

  const surface = useMemo<QuickDictationSurface>(() => {
    if (props.runtime.ptt.status === 'error' && latestText) {
      return 'recovery'
    }

    if (props.runtime.ptt.status === 'capturing' || props.runtime.ptt.status === 'arming') {
      return 'recording'
    }

    if (
      props.runtime.ptt.status === 'recognizing' ||
      props.runtime.ptt.status === 'post_processing' ||
      props.runtime.ptt.status === 'delivering'
    ) {
      return 'processing'
    }

    if (showSentFeedback) {
      return 'sent'
    }

    return 'idle'
  }, [latestText, props.runtime.ptt.status, showSentFeedback])

  const recordingDuration = captureStartedAt ? Math.max(0, Math.floor((tick - captureStartedAt) / 1000)) : 0
  const helpCopy = describeSupportCopy(surface, props.runtime.ptt.status)

  return (
    <div className="page page--wide">
      <header className="surface-header">
        <div className="surface-header__eyebrow">Quick Dictation</div>
      </header>

      <section className="hud-preview" aria-label="Quick dictation HUD preview">
        <div className="hud-preview__stage">
          {surface === 'recording' ? (
            <div className="hud-card hud-card--recording">
              <div className="hud-card__motion hud-card__motion--recording" aria-hidden="true">
                <span />
              </div>
              <div className="hud-card__timer">{formatShortDuration(recordingDuration)}</div>
            </div>
          ) : null}

          {surface === 'processing' ? (
            <div className="hud-card hud-card--processing">
              <div className="hud-card__motion hud-card__motion--processing" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
            </div>
          ) : null}

          {surface === 'sent' ? (
            <div className="hud-card hud-card--sent">
              <div className="hud-card__motion hud-card__motion--sent" aria-hidden="true">
                <span />
              </div>
            </div>
          ) : null}

          {surface === 'recovery' ? (
            <div className="hud-strip" role="alert">
              <div className="hud-strip__copy">
                <div className="hud-strip__title">Couldn't type automatically</div>
                <div className="hud-strip__body">Copy to clipboard, then paste into the target app.</div>
              </div>
              <div className="hud-strip__actions">
                <Button
                  label={props.busyAction === 'ptt-copy-latest' ? 'Copying...' : 'Copy'}
                  disabled={Boolean(props.busyAction) || !latestText}
                  variant="primary"
                  size="small"
                  onClick={props.onCopyLatestText}
                />
                <Button
                  label="Try again"
                  disabled={props.pttStartDisabled}
                  variant="ghost"
                  size="small"
                  onClick={props.onStartPtt}
                />
              </div>
            </div>
          ) : null}

          {surface === 'idle' ? (
            <div className="hud-standby">
              <div className="hud-standby__hotkey">{describePttHotkey(props.settings.input.pttHotkey)}</div>
              <div className="hud-standby__body">Hold to dictate</div>
            </div>
          ) : null}
        </div>

        <div className="hud-preview__support">
          <div className="support-grid">
            <div className="support-grid__item">
              <span className="support-grid__label">Hotkey</span>
              <span className="support-grid__value">{describePttHotkey(props.settings.input.pttHotkey)}</span>
            </div>
            <div className="support-grid__item">
              <span className="support-grid__label">Delivery</span>
              <span className="support-grid__value">{describeOutputMethod(props.settings.output.method)}</span>
            </div>
            <div className="support-grid__item">
              <span className="support-grid__label">State</span>
              <span className="support-grid__value">{helpCopy.label}</span>
            </div>
          </div>

          <p className="support-copy">{helpCopy.body}</p>

          <div className="support-actions">
            <Button
              label={props.busyAction === 'ptt-start' ? 'Starting...' : 'Start dictation'}
              disabled={props.pttStartDisabled}
              variant="primary"
              onClick={props.onStartPtt}
            />
            <Button
              label={props.busyAction === 'ptt-stop' ? 'Stopping...' : 'Stop dictation'}
              disabled={props.pttStopDisabled}
              variant="secondary"
              onClick={props.onStopPtt}
            />
            <Button
              label={props.busyAction === 'ptt-copy-latest' ? 'Copying...' : 'Copy latest text'}
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
        </div>
      </section>

      <section className="result-panel" aria-label="Latest dictation result">
        <div className="result-panel__header">
          <div className="result-panel__eyebrow">Latest result</div>
          {latestText && props.runtime.ptt.lastResult ? (
            <div className="result-panel__meta">
              Last result was {describeDeliveredVia(latestDelivery)}.
            </div>
          ) : null}
        </div>

        <div className={`result-panel__body ${latestText ? '' : 'result-panel__body--empty'}`} role="status" aria-live="polite">
          {latestText ?? 'No recent dictation yet.'}
        </div>
      </section>
    </div>
  )
}

function describeSupportCopy(surface: QuickDictationSurface, status: PttStatus) {
  switch (surface) {
    case 'recording':
      return {
        label: 'Recording',
        body: 'Release the hotkey when you finish speaking.'
      }
    case 'processing':
      return {
        label: 'Processing',
        body: 'Transcribing your speech...'
      }
    case 'sent':
      return {
        label: 'Sent',
        body: 'Text delivered successfully.'
      }
    case 'recovery':
      return {
        label: 'Recovery',
        body: 'Automatic delivery failed. Copy the text below and paste it manually.'
      }
    case 'idle':
    default:
      return {
        label: status === 'idle' ? 'Ready' : 'Standby',
        body: 'Press and hold the hotkey to start dictating.'
      }
  }
}

function getFailedTranscriptText(runtime: AppRuntimeSnapshot): string | null {
  const transcriptText = runtime.ptt.error?.detail?.transcriptText
  return typeof transcriptText === 'string' ? transcriptText : null
}

function formatShortDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}
