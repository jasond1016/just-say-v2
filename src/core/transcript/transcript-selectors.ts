import type { TranscriptBlock, TranscriptBlockDraft, TranscriptState } from '../../shared/api-types'

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

export function selectVisibleTimeline(transcript: TranscriptState): TranscriptTimelineItem[] {
  const committed = transcript.committedBlocks
    .slice()
    .sort(sortCommittedBlocks)
    .map((block) => ({
      id: block.id,
      kind: 'committed' as const,
      source: block.source,
      startedAt: block.startedAt,
      primaryText: block.text,
      ...(block.translatedText ? { secondaryText: block.translatedText } : {})
    }))
  const drafts = Object.values(transcript.activeDrafts)
    .filter((draft): draft is TranscriptBlockDraft => Boolean(draft))
    .slice()
    .sort(sortDrafts)
    .map((draft) => ({
      id: draft.id,
      kind: 'draft' as const,
      source: draft.source,
      startedAt: draft.startedAt,
      primaryText: [draft.stableText, draft.previewText].filter(Boolean).join(' '),
      ...(draft.translatedPreviewText ? { secondaryText: draft.translatedPreviewText } : {})
    }))

  return [...committed, ...drafts]
}

export function selectPlainText(transcript: TranscriptState): string {
  return transcript.committedBlocks.map((block) => block.text).join('\n')
}

export function selectTranslatedPlainText(transcript: TranscriptState): string | undefined {
  const translatedPlainText = transcript.committedBlocks
    .map((block) => block.translatedText)
    .filter((text): text is string => Boolean(text))
    .join('\n')

  return translatedPlainText || undefined
}

export function selectLatestCommittedBlock(transcript: TranscriptState): TranscriptBlock | null {
  const [latestCommittedBlock] = transcript.committedBlocks.slice().sort(sortCommittedBlocks).slice(-1)
  return latestCommittedBlock ?? null
}

export function selectHasDraftContent(transcript: TranscriptState): boolean {
  return Object.values(transcript.activeDrafts).some((draft) => {
    if (!draft) {
      return false
    }

    return Boolean(draft.stableText.trim() || draft.previewText.trim())
  })
}

function sortCommittedBlocks(left: TranscriptBlock, right: TranscriptBlock): number {
  if (left.startedAt !== right.startedAt) {
    return left.startedAt - right.startedAt
  }

  if (left.endedAt !== right.endedAt) {
    return left.endedAt - right.endedAt
  }

  return left.id.localeCompare(right.id)
}

function sortDrafts(left: TranscriptBlockDraft, right: TranscriptBlockDraft): number {
  if (left.updatedAt !== right.updatedAt) {
    return left.updatedAt - right.updatedAt
  }

  if (left.startedAt !== right.startedAt) {
    return left.startedAt - right.startedAt
  }

  return left.id.localeCompare(right.id)
}
