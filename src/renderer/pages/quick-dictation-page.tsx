import { useState } from 'react'

import type { AppSettings, AppRuntimeSnapshot, LocalServiceStatus, PttHotkey, SavedTranscript } from '../../shared/api-types'
import { describePttHotkey } from '../ui/copy'
import { useT } from '../i18n-context'

const KEYCAP_BY_HOTKEY: Record<PttHotkey, { src: string; label: string }> = {
  RCtrl: { src: './assets/keycap-rctrl.png', label: 'R Ctrl' },
  RAlt: { src: './assets/keycap-ralt.png', label: 'R Alt' },
}

export function QuickDictationPage(props: {
  runtime: AppRuntimeSnapshot
  settings: AppSettings
  localServiceStatus: LocalServiceStatus
  recentDictations: SavedTranscript[]
  onCopyText: (id: string) => void
  onOpenHistory: () => void
}) {
  const t = useT()
  const hotkey = props.settings.input.pttHotkey
  const hotkeyLabel = describePttHotkey(hotkey)
  const keycap = KEYCAP_BY_HOTKEY[hotkey]
  const isPressed = props.runtime.ptt.status === 'arming' || props.runtime.ptt.status === 'capturing'

  return (
    <div className="page page--speak">
      <header className="speak-header">
        <h1 className="page-title">Speak</h1>
        <p className="speak-header__subtitle">{t.speakSubtitle}</p>
      </header>

      <section className="speak-keycap-area" aria-label={`Press ${hotkeyLabel} to dictate`}>
        <div className={`speak-keycap ${isPressed ? 'speak-keycap--pressed' : ''}`}>
          <img
            className="speak-keycap__image"
            src={keycap.src}
            alt={keycap.label}
            width={320}
            height={187}
            draggable={false}
          />
        </div>
        <span className="speak-keycap-area__hint">{t.speakHoldToTalk}</span>
      </section>

      <section className="speak-recent" aria-label="Recent dictation output">
        <h2 className="speak-recent__heading">{t.speakRecentHeading}</h2>
        {props.recentDictations.length > 0 ? (
          <div className="speak-recent__list">
            {props.recentDictations.map((item) => (
              <RecentRow key={item.id} item={item} onCopy={props.onCopyText} />
            ))}
          </div>
        ) : (
          <div className="speak-recent__empty">{t.speakRecentEmpty}</div>
        )}
        <div className="speak-recent__footer">
          <button type="button" className="speak-recent__history-link" onClick={props.onOpenHistory}>
            {t.speakViewAllHistory}
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </section>
    </div>
  )
}

function RecentRow(props: { item: SavedTranscript; onCopy: (id: string) => void }) {
  const t = useT()
  const [menuOpen, setMenuOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const displayText = props.item.plainText.length > 100
    ? props.item.plainText.slice(0, 100) + '…'
    : props.item.plainText

  const timeLabel = formatRelativeTime(props.item.endedAt, t)

  const handleCopy = () => {
    props.onCopy(props.item.id)
    setCopied(true)
    setMenuOpen(false)
    window.setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="speak-row">
      <span className="speak-row__time">{timeLabel}</span>
      <span className="speak-row__text">{displayText}</span>
      <div className="speak-row__actions">
        <button
          type="button"
          className="speak-row__menu-trigger"
          aria-label="Actions"
          onClick={() => setMenuOpen(!menuOpen)}
        >
          {copied ? '✓' : '⋯'}
        </button>
        {menuOpen && !copied ? (
          <div className="speak-row__menu">
            <button type="button" className="speak-row__menu-item" onClick={handleCopy}>
              {t.speakCopyText}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function formatRelativeTime(timestamp: number, t: { speakYesterday: (time: string) => string }): string {
  const date = new Date(timestamp)
  const today = new Date()

  const isToday = date.toDateString() === today.toDateString()
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  const isYesterday = date.toDateString() === yesterday.toDateString()

  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const time = `${hours}:${minutes}`

  if (isToday) {
    return time
  }
  if (isYesterday) {
    return t.speakYesterday(time)
  }
  return `${date.getMonth() + 1}/${date.getDate()} ${time}`
}
