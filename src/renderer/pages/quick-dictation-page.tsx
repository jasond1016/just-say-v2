import { useState } from 'react'

import type { AppSettings, AppRuntimeSnapshot, LocalServiceStatus, SavedTranscript } from '../../shared/api-types'
import { describeOutputMethod, describePttHotkey } from '../ui/copy'

export function QuickDictationPage(props: {
  runtime: AppRuntimeSnapshot
  settings: AppSettings
  localServiceStatus: LocalServiceStatus
  recentDictations: SavedTranscript[]
  onCopyText: (id: string) => void
  onOpenHistory: () => void
}) {
  const stateLabel = describeState(props.runtime.ptt.status, props.localServiceStatus)
  const stateClass = stateLabel.tone === 'ready' ? 'qd-state--ready'
    : stateLabel.tone === 'active' ? 'qd-state--active'
    : 'qd-state--unavailable'

  return (
    <div className="page page--wide">
      <header className="surface-header">
        <div className="surface-header__eyebrow">Quick Dictation</div>
      </header>

      <section className="qd-config" aria-label="Dictation configuration">
        <div className="qd-config__item">
          <span className="qd-config__label">Hotkey</span>
          <span className="qd-config__value qd-config__value--mono">
            {describePttHotkey(props.settings.input.pttHotkey)}
          </span>
          <span className="qd-config__sub">Hold to dictate</span>
        </div>
        <div className="qd-config__item">
          <span className="qd-config__label">Delivery</span>
          <span className="qd-config__value">{describeOutputMethod(props.settings.output.method)}</span>
        </div>
        <div className="qd-config__item">
          <span className="qd-config__label">State</span>
          <span className={`qd-config__value ${stateClass}`}>{stateLabel.text}</span>
        </div>
      </section>

      <section className="qd-results" aria-label="Recent dictation results">
        <div className="qd-results__header">
          <span className="qd-results__eyebrow">Recent results</span>
        </div>
        {props.recentDictations.length > 0 ? (
          <div className="qd-results__list">
            {props.recentDictations.map((item) => (
              <ResultRow key={item.id} item={item} onCopy={props.onCopyText} />
            ))}
          </div>
        ) : (
          <div className="qd-results__empty">No recent dictations.</div>
        )}
        <div className="qd-results__footer">
          <button type="button" className="qd-results__history-link" onClick={props.onOpenHistory}>
            View all in History
          </button>
        </div>
      </section>
    </div>
  )
}

function ResultRow(props: { item: SavedTranscript; onCopy: (id: string) => void }) {
  const [copied, setCopied] = useState(false)
  const displayText = props.item.plainText.length > 120
    ? props.item.plainText.slice(0, 120) + '…'
    : props.item.plainText

  const handleCopy = () => {
    props.onCopy(props.item.id)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="qd-result-row">
      <span className="qd-result-row__text">{displayText}</span>
      <button
        type="button"
        className={`qd-result-row__copy ${copied ? 'qd-result-row__copy--done' : ''}`}
        onClick={handleCopy}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}

function describeState(pttStatus: string, serviceStatus: LocalServiceStatus) {
  if (serviceStatus === 'failed' || serviceStatus === 'stopped') {
    return { text: 'Unavailable', tone: 'unavailable' as const }
  }

  switch (pttStatus) {
    case 'capturing':
    case 'arming':
      return { text: 'Recording', tone: 'active' as const }
    case 'recognizing':
    case 'post_processing':
    case 'delivering':
      return { text: 'Processing', tone: 'active' as const }
    default:
      return { text: 'Ready', tone: 'ready' as const }
  }
}
