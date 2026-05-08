import type {
  BlockCommittedPayload,
  DraftUpdatePayload,
  TranslationUpdatedPayload
} from '../contracts/engine'

export type TranscriptEvent =
  | {
      type: 'draft-updated'
      payload: DraftUpdatePayload
    }
  | {
      type: 'block-committed'
      payload: BlockCommittedPayload
    }
  | {
      type: 'translation-updated'
      payload: TranslationUpdatedPayload
    }
  | {
      type: 'reset'
    }

export type TranscriptEventType = TranscriptEvent['type']
