import type {
  AppErrorPayload,
  AudioChunk,
  EngineCapabilities,
  EngineWarningPayload,
  TranscriptBlock
} from '../../shared/api-types'
import type { CaptureSource, SessionMode, WordTiming } from '../../shared/primitive-types'

export type WarmupInput = {
  mode: SessionMode
  language: string
}

export type StartSessionInput = {
  sessionId: string
  mode: SessionMode
  sources: CaptureSource[]
  language: string
  translation: {
    enabled: boolean
    targetLanguage?: string
  }
}

export type DraftUpdatePayload = {
  blockId: string
  source: CaptureSource
  speakerLabel?: string
  stableText: string
  previewText: string
  translatedPreviewText?: string
  words?: WordTiming[]
  startedAt: number
  updatedAt: number
}

export type BlockCommittedPayload = {
  block: TranscriptBlock
}

export type TranslationUpdatedPayload = {
  blockId: string
  translatedText: string
  translatedPreviewText?: string
}

export type RecognitionEvent =
  | { type: 'session-ready' }
  | { type: 'draft-updated'; payload: DraftUpdatePayload }
  | { type: 'block-committed'; payload: BlockCommittedPayload }
  | { type: 'translation-updated'; payload: TranslationUpdatedPayload }
  | { type: 'warning'; payload: EngineWarningPayload }
  | { type: 'error'; payload: AppErrorPayload }
  | { type: 'session-ended' }

export type Unsubscribe = () => void

export interface RecognitionEngine {
  getCapabilities(): Promise<EngineCapabilities>
  warmup(input: WarmupInput): Promise<void>
  startSession(input: StartSessionInput): Promise<void>
  pushAudio(chunk: AudioChunk): void
  stopSession(): Promise<void>
  abortSession(): Promise<void>
  onEvent(listener: (event: RecognitionEvent) => void): Unsubscribe
}
