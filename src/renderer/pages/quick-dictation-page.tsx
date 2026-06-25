import { Check, Ellipsis, Keyboard } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import type { AppSettings, AppRuntimeSnapshot, LocalServiceStatus, PttHotkey, SavedTranscript } from '../../shared/api-types'
import { describePttHotkey } from '../ui/copy'
import { useT } from '../i18n-context'
import { appIconProps } from '../ui/icons'
import { PageChrome } from '../ui/page-chrome'
import { RecentHistorySection, formatRecentTime } from '../ui/page-recent'

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
  onDeleteText: (id: string) => void
  onOpenHistory: () => void
  onOpenShortcutSettings: () => void
}) {
  const t = useT()
  const hotkey = props.settings.input.pttHotkey
  const hotkeyLabel = describePttHotkey(hotkey)
  const keycap = KEYCAP_BY_HOTKEY[hotkey]
  const isPressed = props.runtime.ptt.status === 'arming' || props.runtime.ptt.status === 'capturing'

  return (
    <div className="page page--feature-home">
      <PageChrome
        title={t.navSpeak}
        subtitle={t.speakSubtitle}
        actions={
          <button type="button" className="session-action-btn session-action-btn--start" onClick={props.onOpenShortcutSettings}>
            <Keyboard {...appIconProps(16)} />
            {t.speakChangeHotkey}
          </button>
        }
      />

      <section className="feature-home-hero speak-keycap-area" aria-label={`Press ${hotkeyLabel} to dictate`}>
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

      <RecentHistorySection
        heading={t.speakRecentHeading}
        emptyLabel={t.speakRecentEmpty}
        viewAllLabel={t.speakViewAllHistory}
        isEmpty={props.recentDictations.length === 0}
        onViewAll={props.onOpenHistory}
      >
        {props.recentDictations.map((item) => (
          <RecentRow
            key={item.id}
            item={item}
            onCopy={props.onCopyText}
            onDelete={props.onDeleteText}
          />
        ))}
      </RecentHistorySection>
    </div>
  )
}

function RecentRow(props: {
  item: SavedTranscript
  onCopy: (id: string) => void
  onDelete: (id: string) => void
}) {
  const t = useT()
  const actionsRef = useRef<HTMLDivElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuPlacement, setMenuPlacement] = useState<'above' | 'below'>('below')
  const [copied, setCopied] = useState(false)
  const displayText = props.item.plainText.length > 100
    ? props.item.plainText.slice(0, 100) + '…'
    : props.item.plainText

  const timeLabel = formatRecentTime(props.item.endedAt, t)

  useEffect(() => {
    if (!menuOpen) {
      return
    }

    const onPointerDown = (event: PointerEvent) => {
      const actions = actionsRef.current

      if (!actions || !(event.target instanceof Node) || actions.contains(event.target)) {
        return
      }

      setMenuOpen(false)
    }

    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [menuOpen])

  const handleCopy = () => {
    props.onCopy(props.item.id)
    setCopied(true)
    setMenuOpen(false)
    window.setTimeout(() => setCopied(false), 1500)
  }

  const handleDelete = () => {
    props.onDelete(props.item.id)
    setMenuOpen(false)
  }

  const toggleMenu = () => {
    if (menuOpen) {
      setMenuOpen(false)
      return
    }

    const actions = actionsRef.current
    if (actions) {
      const rect = actions.getBoundingClientRect()
      const spaceBelow = window.innerHeight - rect.bottom
      setMenuPlacement(spaceBelow < 96 ? 'above' : 'below')
    }

    setMenuOpen(true)
  }

  return (
    <div className="speak-row">
      <span className="speak-row__time">{timeLabel}</span>
      <span className="speak-row__text">{displayText}</span>
      <div className="speak-row__actions" ref={actionsRef}>
        <button
          type="button"
          className="speak-row__menu-trigger"
          aria-label="Actions"
          aria-expanded={menuOpen}
          onClick={toggleMenu}
        >
          {copied ? <Check {...appIconProps(16)} /> : <Ellipsis {...appIconProps(16)} />}
        </button>
        {menuOpen && !copied ? (
          <div
            className={`speak-row__menu ${menuPlacement === 'above' ? 'speak-row__menu--above' : ''}`}
            role="menu"
          >
            <button type="button" className="speak-row__menu-item" role="menuitem" onClick={handleCopy}>
              {t.speakCopyText}
            </button>
            <button
              type="button"
              className="speak-row__menu-item speak-row__menu-item--danger"
              role="menuitem"
              onClick={handleDelete}
            >
              {t.speakDeleteText}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}

