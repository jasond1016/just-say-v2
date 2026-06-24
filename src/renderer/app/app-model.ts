import type { AppRuntimeSnapshot, SavedTranscript } from '../../shared/api-types'

export type AppSection = 'quick-dictation' | 'live-session' | 'history' | 'settings'

export type SettingsSectionId = 'general' | 'recording' | 'recognition' | 'shortcuts' | 'advanced'

export const APP_SECTIONS: Array<{ id: AppSection; labelKey: 'navSpeak' | 'navSession' | 'navArchive' | 'navSettings'; icon: string }> = [
  { id: 'quick-dictation', labelKey: 'navSpeak', icon: 'mic' },
  { id: 'live-session', labelKey: 'navSession', icon: 'session' },
  { id: 'history', labelKey: 'navArchive', icon: 'archive' },
  { id: 'settings', labelKey: 'navSettings', icon: 'settings' }
]

export function getPreferredSection(runtime: AppRuntimeSnapshot): AppSection {
  return runtime.liveSession ? 'live-session' : 'quick-dictation'
}

export function formatDuration(durationSec: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationSec))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export function filterHistoryItems(
  items: SavedTranscript[],
  query: string,
  mode: SavedTranscript['mode'] | 'all'
): SavedTranscript[] {
  const keyword = query.trim().toLowerCase()

  return items.filter((item) => {
    if (mode !== 'all' && item.mode !== mode) {
      return false
    }

    if (!keyword) {
      return true
    }

    return [
      item.title,
      item.plainText,
      item.translatedPlainText ?? ''
    ].some((value) => value.toLowerCase().includes(keyword))
  })
}
