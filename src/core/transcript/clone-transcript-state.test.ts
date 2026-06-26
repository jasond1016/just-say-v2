import { describe, expect, it } from 'vitest'

import { cloneTranscriptState } from './clone-transcript-state'
import { INITIAL_TRANSCRIPT_STATE } from './transcript-reducer'

describe('cloneTranscriptState', () => {
  it('deep-clones committed blocks, drafts, and word timings', () => {
    const transcript = {
      committedBlocks: [
        {
          id: 'b1',
          source: 'system' as const,
          text: 'hello',
          startedAt: 1,
          endedAt: 2,
          words: [{ text: 'hello', startMs: 1, endMs: 2 }]
        }
      ],
      activeDrafts: {
        microphone: {
          id: 'd1',
          source: 'microphone' as const,
          stableText: 'hi',
          previewText: ' there',
          startedAt: 3,
          updatedAt: 4
        }
      },
      revision: 2
    }

    const clone = cloneTranscriptState(transcript)

    expect(clone).toEqual(transcript)
    expect(clone).not.toBe(transcript)
    expect(clone.committedBlocks[0]).not.toBe(transcript.committedBlocks[0])
    expect(clone.committedBlocks[0]?.words).not.toBe(transcript.committedBlocks[0]?.words)
    expect(clone.activeDrafts.microphone).not.toBe(transcript.activeDrafts.microphone)
  })

  it('returns an empty transcript unchanged in shape', () => {
    expect(cloneTranscriptState(INITIAL_TRANSCRIPT_STATE)).toEqual(INITIAL_TRANSCRIPT_STATE)
  })
})
