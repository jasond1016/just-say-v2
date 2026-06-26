import type { TranscriptState } from '../../shared/api-types'

export function cloneTranscriptState(transcript: TranscriptState): TranscriptState {
  return {
    committedBlocks: transcript.committedBlocks.map((block) => ({
      ...block,
      ...(block.words ? { words: [...block.words] } : {})
    })),
    activeDrafts: Object.fromEntries(
      Object.entries(transcript.activeDrafts).map(([source, draft]) => [
        source,
        draft
          ? {
              ...draft,
              ...(draft.words ? { words: [...draft.words] } : {})
            }
          : draft
      ])
    ),
    revision: transcript.revision
  }
}
