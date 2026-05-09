import { describe, expect, it } from 'vitest'

import type { AppRuntimeSnapshot, SavedTranscript, TranscriptState } from '../../shared/api-types'
import { buildTranscriptTimeline, filterHistoryItems, formatDuration, getPreferredSection } from './app-model'

describe('app-model', () => {
  it('prefers the live session section when a meeting is active', () => {
    const runtime: AppRuntimeSnapshot = {
      ptt: {
        status: 'idle'
      },
      liveSession: {
        sessionId: 'meeting-1',
        status: 'streaming',
        startedAt: 100,
        durationSec: 12,
        transcript: {
          committedBlocks: [],
          activeDrafts: {},
          revision: 0
        },
        engineProfileId: 'local-fast',
        translationEnabled: false
      },
      services: {
        localService: 'healthy'
      }
    }

    expect(getPreferredSection(runtime)).toBe('live-session')
  })

  it('builds a timeline that merges committed blocks and drafts in chronological order', () => {
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
          id: 'draft-1',
          source: 'microphone',
          stableText: 'Draft',
          previewText: 'in flight',
          startedAt: 25,
          updatedAt: 26
        }
      },
      revision: 3
    }

    expect(buildTranscriptTimeline(transcript)).toEqual([
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
        source: 'microphone',
        startedAt: 25,
        primaryText: 'Draft in flight'
      }
    ])
  })

  it('formats durations and filters history items by mode and keyword', () => {
    const items: SavedTranscript[] = [
      {
        id: 'tx-1',
        mode: 'ptt',
        title: 'PTT hello',
        startedAt: 1,
        endedAt: 2,
        plainText: 'hello world',
        blocks: [],
        metadata: {
          engineProfileId: 'local-fast',
          includeMicrophone: true,
          translationEnabled: false
        }
      },
      {
        id: 'tx-2',
        mode: 'meeting',
        title: 'Weekly sync',
        startedAt: 3,
        endedAt: 4,
        plainText: 'meeting notes',
        translatedPlainText: '会议记录',
        blocks: [],
        metadata: {
          engineProfileId: 'local-fast',
          includeMicrophone: false,
          translationEnabled: true
        }
      }
    ]

    expect(formatDuration(125)).toBe('02:05')
    expect(filterHistoryItems(items, 'meeting', 'meeting')).toEqual([items[1]])
    expect(filterHistoryItems(items, 'hello', 'all')).toEqual([items[0]])
  })
})
