import { describe, expect, it } from 'vitest'

import type { TranscriptState } from '../../shared/api-types'
import {
  selectHasDraftContent,
  selectLatestCommittedBlock,
  selectPlainText,
  selectTranslatedPlainText,
  selectVisibleTimeline
} from './transcript-selectors'

describe('transcript-selectors', () => {
  it('derives a stable visible timeline from committed blocks and drafts', () => {
    const transcript: TranscriptState = {
      committedBlocks: [
        {
          id: 'block-2',
          source: 'system',
          text: 'Committed later',
          startedAt: 20,
          endedAt: 30
        },
        {
          id: 'block-1',
          source: 'microphone',
          text: 'Committed first',
          translatedText: 'First translation',
          startedAt: 10,
          endedAt: 15
        }
      ],
      activeDrafts: {
        microphone: {
          id: 'draft-2',
          source: 'microphone',
          stableText: 'Draft',
          previewText: 'newer',
          translatedPreviewText: '草稿 新',
          startedAt: 32,
          updatedAt: 40
        },
        system: {
          id: 'draft-1',
          source: 'system',
          stableText: 'Older',
          previewText: 'draft',
          startedAt: 31,
          updatedAt: 35
        }
      },
      revision: 4
    }

    expect(selectVisibleTimeline(transcript)).toEqual([
      {
        id: 'block-1',
        kind: 'committed',
        source: 'microphone',
        startedAt: 10,
        primaryText: 'Committed first',
        secondaryText: 'First translation'
      },
      {
        id: 'block-2',
        kind: 'committed',
        source: 'system',
        startedAt: 20,
        primaryText: 'Committed later'
      },
      {
        id: 'draft-1',
        kind: 'draft',
        source: 'system',
        startedAt: 31,
        primaryText: 'Older draft'
      },
      {
        id: 'draft-2',
        kind: 'draft',
        source: 'microphone',
        startedAt: 32,
        primaryText: 'Draft newer',
        secondaryText: '草稿 新'
      }
    ])
  })

  it('derives transcript text helpers from committed blocks and active drafts', () => {
    const transcript: TranscriptState = {
      committedBlocks: [
        {
          id: 'block-1',
          source: 'microphone',
          text: 'hello',
          translatedText: '你好',
          startedAt: 10,
          endedAt: 15
        },
        {
          id: 'block-2',
          source: 'system',
          text: 'world',
          startedAt: 20,
          endedAt: 30
        }
      ],
      activeDrafts: {
        microphone: {
          id: 'draft-1',
          source: 'microphone',
          stableText: '',
          previewText: 'still listening',
          startedAt: 31,
          updatedAt: 32
        }
      },
      revision: 3
    }

    expect(selectPlainText(transcript)).toBe('hello\nworld')
    expect(selectTranslatedPlainText(transcript)).toBe('你好')
    expect(selectLatestCommittedBlock(transcript)?.id).toBe('block-2')
    expect(selectHasDraftContent(transcript)).toBe(true)
  })
})
