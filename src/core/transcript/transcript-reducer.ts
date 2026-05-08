import type {
  TranscriptBlock,
  TranscriptBlockDraft,
  TranscriptState
} from '../../shared/api-types'
import type { TranscriptEvent } from './transcript-types'

export const INITIAL_TRANSCRIPT_STATE: TranscriptState = {
  committedBlocks: [],
  activeDrafts: {},
  revision: 0
}

export function transcriptReducer(
  state: TranscriptState = INITIAL_TRANSCRIPT_STATE,
  event: TranscriptEvent
): TranscriptState {
  switch (event.type) {
    case 'draft-updated': {
      const nextDraft: TranscriptBlockDraft = {
        id: event.payload.blockId,
        source: event.payload.source,
        stableText: event.payload.stableText,
        previewText: event.payload.previewText,
        startedAt: event.payload.startedAt,
        updatedAt: event.payload.updatedAt,
        ...(event.payload.speakerLabel !== undefined
          ? { speakerLabel: event.payload.speakerLabel }
          : {}),
        ...(event.payload.translatedPreviewText !== undefined
          ? { translatedPreviewText: event.payload.translatedPreviewText }
          : {}),
        ...(event.payload.words !== undefined ? { words: event.payload.words } : {})
      }

      return withUpdatedDraft(state, nextDraft)
    }
    case 'block-committed': {
      const { block } = event.payload
      const committedExists = state.committedBlocks.some((existingBlock) => existingBlock.id === block.id)
      const nextCommittedBlocks = committedExists
        ? state.committedBlocks
        : [...state.committedBlocks, block].sort(sortBlocksByStartedAt)
      const nextDrafts = clearDraftByBlockId(state.activeDrafts, block.id)

      if (nextCommittedBlocks === state.committedBlocks && nextDrafts === state.activeDrafts) {
        return state
      }

      return {
        committedBlocks: nextCommittedBlocks,
        activeDrafts: nextDrafts,
        revision: state.revision + 1
      }
    }
    case 'translation-updated': {
      const translatedState = patchTranslation(state, event.payload.blockId, event.payload.translatedText, event.payload.translatedPreviewText)
      return translatedState
    }
    case 'reset':
      return isInitialTranscriptState(state) ? state : INITIAL_TRANSCRIPT_STATE
    default:
      return assertNever(event)
  }
}

function withUpdatedDraft(state: TranscriptState, draft: TranscriptBlockDraft): TranscriptState {
  const currentDraft = state.activeDrafts[draft.source]

  if (areDraftsEqual(currentDraft, draft)) {
    return state
  }

  return {
    committedBlocks: state.committedBlocks,
    activeDrafts: {
      ...state.activeDrafts,
      [draft.source]: draft
    },
    revision: state.revision + 1
  }
}

function clearDraftByBlockId(
  drafts: TranscriptState['activeDrafts'],
  blockId: string
): TranscriptState['activeDrafts'] {
  let changed = false
  const nextDrafts: TranscriptState['activeDrafts'] = {}

  for (const source of Object.keys(drafts) as Array<keyof TranscriptState['activeDrafts']>) {
    const draft = drafts[source]

    if (!draft) {
      continue
    }

    if (draft.id === blockId) {
      changed = true
      continue
    }

    nextDrafts[source] = draft
  }

  return changed ? nextDrafts : drafts
}

function patchTranslation(
  state: TranscriptState,
  blockId: string,
  translatedText: string,
  translatedPreviewText?: string
): TranscriptState {
  const committedIndex = state.committedBlocks.findIndex((block) => block.id === blockId)

  if (committedIndex >= 0) {
    const committedBlock = state.committedBlocks[committedIndex]

    if (!committedBlock) {
      return state
    }

    if (committedBlock.translatedText === translatedText) {
      return state
    }

    const nextCommittedBlocks = state.committedBlocks.slice()
    nextCommittedBlocks[committedIndex] = {
      ...committedBlock,
      translatedText
    } satisfies TranscriptBlock

    return {
      committedBlocks: nextCommittedBlocks,
      activeDrafts: state.activeDrafts,
      revision: state.revision + 1
    }
  }

  const draftEntry = findDraftEntryByBlockId(state.activeDrafts, blockId)

  if (!draftEntry) {
    return state
  }

  const nextTranslatedPreviewText = translatedPreviewText ?? translatedText

  if (draftEntry.draft.translatedPreviewText === nextTranslatedPreviewText) {
    return state
  }

  return {
    committedBlocks: state.committedBlocks,
    activeDrafts: {
      ...state.activeDrafts,
      [draftEntry.source]: {
        ...draftEntry.draft,
        translatedPreviewText: nextTranslatedPreviewText
      }
    },
    revision: state.revision + 1
  }
}

function findDraftEntryByBlockId(
  drafts: TranscriptState['activeDrafts'],
  blockId: string
): { source: keyof TranscriptState['activeDrafts']; draft: TranscriptBlockDraft } | null {
  for (const source of Object.keys(drafts) as Array<keyof TranscriptState['activeDrafts']>) {
    const draft = drafts[source]

    if (draft && draft.id === blockId) {
      return { source, draft }
    }
  }

  return null
}

function sortBlocksByStartedAt(left: TranscriptBlock, right: TranscriptBlock): number {
  if (left.startedAt !== right.startedAt) {
    return left.startedAt - right.startedAt
  }

  return left.endedAt - right.endedAt
}

function areDraftsEqual(
  currentDraft: TranscriptBlockDraft | undefined,
  nextDraft: TranscriptBlockDraft
): boolean {
  if (!currentDraft) {
    return false
  }

  return (
    currentDraft.id === nextDraft.id &&
    currentDraft.source === nextDraft.source &&
    currentDraft.speakerLabel === nextDraft.speakerLabel &&
    currentDraft.stableText === nextDraft.stableText &&
    currentDraft.previewText === nextDraft.previewText &&
    currentDraft.translatedPreviewText === nextDraft.translatedPreviewText &&
    currentDraft.startedAt === nextDraft.startedAt &&
    currentDraft.updatedAt === nextDraft.updatedAt &&
    currentDraft.words === nextDraft.words
  )
}

function isInitialTranscriptState(state: TranscriptState): boolean {
  return state.committedBlocks.length === 0 && Object.keys(state.activeDrafts).length === 0 && state.revision === 0
}

function assertNever(value: never): never {
  throw new Error(`Unhandled transcript event: ${String(value)}`)
}
