import { describe, expect, it } from 'vitest'

import { transcriptReducer, INITIAL_TRANSCRIPT_STATE } from './transcript-reducer'
import type { TranscriptEvent } from './transcript-types'

describe('transcriptReducer', () => {
  it('stores the latest draft per source', () => {
    const firstState = transcriptReducer(INITIAL_TRANSCRIPT_STATE, draftUpdatedEvent({
      blockId: 'draft-1',
      source: 'microphone',
      stableText: 'hello',
      previewText: 'hello wor',
      startedAt: 100,
      updatedAt: 200
    }))

    const nextState = transcriptReducer(firstState, draftUpdatedEvent({
      blockId: 'draft-2',
      source: 'microphone',
      stableText: 'hello world',
      previewText: 'hello world',
      startedAt: 100,
      updatedAt: 300
    }))

    expect(nextState.activeDrafts.microphone).toMatchObject({
      id: 'draft-2',
      stableText: 'hello world',
      previewText: 'hello world',
      updatedAt: 300
    })
    expect(Object.keys(nextState.activeDrafts)).toHaveLength(1)
    expect(nextState.revision).toBe(2)
  })

  it('supports concurrent drafts from different sources', () => {
    const withMicDraft = transcriptReducer(INITIAL_TRANSCRIPT_STATE, draftUpdatedEvent({
      blockId: 'mic-1',
      source: 'microphone',
      stableText: 'mic stable',
      previewText: 'mic preview',
      startedAt: 100,
      updatedAt: 110
    }))

    const nextState = transcriptReducer(withMicDraft, draftUpdatedEvent({
      blockId: 'sys-1',
      source: 'system',
      stableText: 'sys stable',
      previewText: 'sys preview',
      startedAt: 120,
      updatedAt: 130
    }))

    expect(nextState.activeDrafts.microphone?.id).toBe('mic-1')
    expect(nextState.activeDrafts.system?.id).toBe('sys-1')
  })

  it('commits blocks in chronological order and clears the matching draft', () => {
    const withDrafts = transcriptReducer(
      transcriptReducer(INITIAL_TRANSCRIPT_STATE, draftUpdatedEvent({
        blockId: 'later',
        source: 'microphone',
        stableText: 'later stable',
        previewText: 'later preview',
        startedAt: 200,
        updatedAt: 220
      })),
      draftUpdatedEvent({
        blockId: 'other-draft',
        source: 'system',
        stableText: 'other stable',
        previewText: 'other preview',
        startedAt: 150,
        updatedAt: 160
      })
    )

    const firstCommitted = transcriptReducer(withDrafts, blockCommittedEvent({
      id: 'later',
      source: 'microphone',
      text: 'later final',
      startedAt: 200,
      endedAt: 260
    }))
    const nextState = transcriptReducer(firstCommitted, blockCommittedEvent({
      id: 'earlier',
      source: 'system',
      text: 'earlier final',
      startedAt: 100,
      endedAt: 140
    }))

    expect(nextState.committedBlocks.map((block) => block.id)).toEqual(['earlier', 'later'])
    expect(nextState.activeDrafts.microphone).toBeUndefined()
    expect(nextState.activeDrafts.system?.id).toBe('other-draft')
  })

  it('patches committed block translations without mutating transcript order', () => {
    const committedState = transcriptReducer(INITIAL_TRANSCRIPT_STATE, blockCommittedEvent({
      id: 'block-1',
      source: 'microphone',
      text: 'hello',
      startedAt: 10,
      endedAt: 20
    }))

    const nextState = transcriptReducer(committedState, {
      type: 'translation-updated',
      payload: {
        blockId: 'block-1',
        translatedText: '你好'
      }
    })

    expect(nextState.committedBlocks).toMatchObject([
      {
        id: 'block-1',
        translatedText: '你好'
      }
    ])
    expect(nextState.revision).toBe(2)
  })

  it('patches draft translations and ignores unknown block ids', () => {
    const withDraft = transcriptReducer(INITIAL_TRANSCRIPT_STATE, draftUpdatedEvent({
      blockId: 'draft-1',
      source: 'microphone',
      stableText: 'hello',
      previewText: 'hello again',
      startedAt: 100,
      updatedAt: 200
    }))

    const translatedState = transcriptReducer(withDraft, {
      type: 'translation-updated',
      payload: {
        blockId: 'draft-1',
        translatedText: '你好',
        translatedPreviewText: '你好呀'
      }
    })
    const unchangedState = transcriptReducer(translatedState, {
      type: 'translation-updated',
      payload: {
        blockId: 'missing',
        translatedText: 'ignored'
      }
    })

    expect(translatedState.activeDrafts.microphone?.translatedPreviewText).toBe('你好呀')
    expect(unchangedState).toBe(translatedState)
  })

  it('does not overwrite an already committed block with a duplicate commit', () => {
    const firstCommit = transcriptReducer(INITIAL_TRANSCRIPT_STATE, blockCommittedEvent({
      id: 'block-1',
      source: 'microphone',
      text: 'first text',
      startedAt: 10,
      endedAt: 20
    }))

    const nextState = transcriptReducer(firstCommit, blockCommittedEvent({
      id: 'block-1',
      source: 'microphone',
      text: 'mutated text',
      startedAt: 10,
      endedAt: 20
    }))

    expect(nextState).toBe(firstCommit)
    expect(nextState.committedBlocks[0]?.text).toBe('first text')
  })

  it('resets back to the initial state', () => {
    const dirtyState = transcriptReducer(INITIAL_TRANSCRIPT_STATE, draftUpdatedEvent({
      blockId: 'draft-1',
      source: 'microphone',
      stableText: 'hello',
      previewText: 'hello',
      startedAt: 100,
      updatedAt: 200
    }))

    expect(transcriptReducer(dirtyState, { type: 'reset' })).toEqual(INITIAL_TRANSCRIPT_STATE)
  })
})

function draftUpdatedEvent(
  overrides: Partial<Extract<TranscriptEvent, { type: 'draft-updated' }>['payload']> &
    Pick<Extract<TranscriptEvent, { type: 'draft-updated' }>['payload'], 'blockId' | 'source'>
): Extract<TranscriptEvent, { type: 'draft-updated' }> {
  return {
    type: 'draft-updated',
    payload: {
      blockId: overrides.blockId,
      source: overrides.source,
      stableText: overrides.stableText ?? '',
      previewText: overrides.previewText ?? '',
      startedAt: overrides.startedAt ?? 0,
      updatedAt: overrides.updatedAt ?? 0,
      ...(overrides.translatedPreviewText !== undefined
        ? { translatedPreviewText: overrides.translatedPreviewText }
        : {}),
      ...(overrides.words !== undefined ? { words: overrides.words } : {}),
      ...(overrides.speakerLabel !== undefined ? { speakerLabel: overrides.speakerLabel } : {})
    }
  }
}

function blockCommittedEvent(
  overrides: Partial<Extract<TranscriptEvent, { type: 'block-committed' }>['payload']['block']> &
    Pick<
      Extract<TranscriptEvent, { type: 'block-committed' }>['payload']['block'],
      'id' | 'source' | 'text' | 'startedAt' | 'endedAt'
    >
): Extract<TranscriptEvent, { type: 'block-committed' }> {
  return {
    type: 'block-committed',
    payload: {
      block: {
        id: overrides.id,
        source: overrides.source,
        text: overrides.text,
        startedAt: overrides.startedAt,
        endedAt: overrides.endedAt,
        ...(overrides.speakerLabel !== undefined ? { speakerLabel: overrides.speakerLabel } : {}),
        ...(overrides.translatedText !== undefined
          ? { translatedText: overrides.translatedText }
          : {}),
        ...(overrides.words !== undefined ? { words: overrides.words } : {})
      }
    }
  }
}
