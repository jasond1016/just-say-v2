import { describe, expect, it } from 'vitest'

import type { AppRuntimeSnapshot } from '../../shared/api-types'
import { INITIAL_RUNTIME_SNAPSHOT } from '../../shared/runtime-snapshot'
import { freezeRuntimeSnapshot } from './freeze-runtime-snapshot'

describe('freezeRuntimeSnapshot', () => {
  it('clones meeting transcripts for draft stability across snapshot reads', () => {
    const snapshot = createSnapshot()

    const frozen = freezeRuntimeSnapshot(snapshot)
    frozen.liveSession!.transcript.activeDrafts.system!.previewText = 'mutated'
    frozen.ptt.lastResult!.text = 'mutated'

    expect(snapshot.liveSession?.transcript.activeDrafts.system?.previewText).toBe('hello wor')
    expect(snapshot.ptt.lastResult?.text).toBe('hello world')
  })

  it('returns a fresh frozen snapshot for idle runtime state', () => {
    expect(freezeRuntimeSnapshot(INITIAL_RUNTIME_SNAPSHOT)).toEqual(INITIAL_RUNTIME_SNAPSHOT)
  })
})

function createSnapshot(): AppRuntimeSnapshot {
  return {
    ptt: {
      status: 'completed',
      lastResult: {
        text: 'hello world',
        deliveredAt: 2000,
        deliveryMethod: 'simulate_input'
      }
    },
    liveSession: {
      sessionId: 'meeting-1',
      status: 'streaming',
      startedAt: 1000,
      durationSec: 3,
      engineProfileId: 'local-fast',
      translationEnabled: false,
      transcript: {
        committedBlocks: [],
        activeDrafts: {
          system: {
            id: 'draft-1',
            source: 'system',
            stableText: 'hello',
            previewText: 'hello wor',
            startedAt: 1000,
            updatedAt: 1100
          }
        },
        revision: 1
      }
    },
    services: {
      localService: 'healthy'
    }
  }
}
