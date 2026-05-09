import { describe, expect, it } from 'vitest'

import type { AppRuntimeSnapshot } from '../../../shared/api-types'
import { selectLiveSessionTimeline } from './runtime-selectors'

describe('runtime-selectors', () => {
  it('returns an empty timeline when there is no live session', () => {
    const runtime: AppRuntimeSnapshot = {
      ptt: {
        status: 'idle'
      },
      liveSession: null,
      services: {
        localService: 'healthy'
      }
    }

    expect(selectLiveSessionTimeline(runtime)).toEqual([])
  })

  it('derives the visible timeline from the live session transcript', () => {
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
          committedBlocks: [
            {
              id: 'block-1',
              source: 'microphone',
              text: 'hello',
              startedAt: 10,
              endedAt: 12
            }
          ],
          activeDrafts: {
            system: {
              id: 'draft-1',
              source: 'system',
              stableText: 'still',
              previewText: 'listening',
              startedAt: 20,
              updatedAt: 30
            }
          },
          revision: 2
        },
        engineProfileId: 'local-fast',
        translationEnabled: false
      },
      services: {
        localService: 'healthy'
      }
    }

    expect(selectLiveSessionTimeline(runtime)).toEqual([
      {
        id: 'block-1',
        kind: 'committed',
        source: 'microphone',
        startedAt: 10,
        primaryText: 'hello'
      },
      {
        id: 'draft-1',
        kind: 'draft',
        source: 'system',
        startedAt: 20,
        primaryText: 'still listening'
      }
    ])
  })
})
