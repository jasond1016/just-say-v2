import type {
  AppRuntimeSnapshot,
  SavedTranscript,
  TranscriptBlock,
  TranscriptBlockDraft,
  TranscriptState
} from '../../shared/api-types'

export type AppSection = 'quick-dictation' | 'live-session' | 'history' | 'settings'

export type TranscriptTimelineItem =
  | {
      id: string
      kind: 'committed'
      source: TranscriptBlock['source']
      startedAt: number
      primaryText: string
      secondaryText?: string
    }
  | {
      id: string
      kind: 'draft'
      source: TranscriptBlockDraft['source']
      startedAt: number
      primaryText: string
      secondaryText?: string
    }

export const APP_SECTIONS: Array<{ id: AppSection; label: string }> = [
  { id: 'quick-dictation', label: 'Quick Dictation' },
  { id: 'live-session', label: 'Live Session' },
  { id: 'history', label: 'History' },
  { id: 'settings', label: 'Settings' }
]

export function getPreferredSection(runtime: AppRuntimeSnapshot): AppSection {
  return runtime.liveSession ? 'live-session' : 'quick-dictation'
}

export function buildTranscriptTimeline(transcript: TranscriptState): TranscriptTimelineItem[] {
  const committed = transcript.committedBlocks.map((block) => ({
    id: block.id,
    kind: 'committed' as const,
    source: block.source,
    startedAt: block.startedAt,
    primaryText: block.text,
    ...(block.translatedText ? { secondaryText: block.translatedText } : {})
  }))
  const drafts = Object.values(transcript.activeDrafts)
    .filter((draft): draft is TranscriptBlockDraft => Boolean(draft))
    .map((draft) => ({
      id: draft.id,
      kind: 'draft' as const,
      source: draft.source,
      startedAt: draft.startedAt,
      primaryText: [draft.stableText, draft.previewText].filter(Boolean).join(' '),
      ...(draft.translatedPreviewText ? { secondaryText: draft.translatedPreviewText } : {})
    }))

  return [...committed, ...drafts].sort((left, right) => {
    if (left.startedAt !== right.startedAt) {
      return left.startedAt - right.startedAt
    }

    if (left.kind === right.kind) {
      return left.id.localeCompare(right.id)
    }

    return left.kind === 'committed' ? -1 : 1
  })
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
