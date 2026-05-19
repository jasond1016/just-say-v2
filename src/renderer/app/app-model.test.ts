import { describe, expect, it } from 'vitest'

import type { AppRuntimeSnapshot, SavedTranscript } from '../../shared/api-types'
import { filterHistoryItems, formatDuration, getPreferredSection } from './app-model'

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
          runtimeFamilyId: 'sensevoice',
          modelIdentifier: 'iic/SenseVoiceSmall',
          deploymentMode: 'managed-local',
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
          runtimeFamilyId: 'sensevoice',
          modelIdentifier: 'iic/SenseVoiceSmall',
          deploymentMode: 'managed-local',
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
