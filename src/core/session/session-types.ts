import type { AppErrorPayload, MeetingStatus, PttStatus } from '../../shared/api-types'
import type { CaptureSource } from '../../shared/primitive-types'

export type SessionStatus = PttStatus | MeetingStatus

type SessionBase = {
  id: string
  engineProfileId: string
  startedAt: number | null
  endedAt: number | null
  sources: CaptureSource[]
  error: AppErrorPayload | null
}

export type PttRecognitionSession = SessionBase & {
  mode: 'ptt'
  status: PttStatus
}

export type MeetingRecognitionSession = SessionBase & {
  mode: 'meeting'
  status: MeetingStatus
}

export type RecognitionSession = PttRecognitionSession | MeetingRecognitionSession

export type PttSessionEvent =
  | { type: 'PTT_HOTKEY_DOWN' }
  | { type: 'CAPTURE_STARTED' }
  | { type: 'PTT_HOTKEY_UP' }
  | { type: 'BLOCK_COMMITTED' }
  | { type: 'TRANSLATION_DONE' }
  | { type: 'SKIP_TRANSLATION' }
  | { type: 'DELIVERY_SUCCEEDED' }
  | { type: 'DELIVERY_FAILED'; error?: AppErrorPayload }
  | { type: 'FAILED'; error?: AppErrorPayload }
  | { type: 'CANCELLED' }
  | { type: 'RESET' }

export type MeetingSessionEvent =
  | { type: 'START_REQUESTED' }
  | { type: 'SESSION_READY' }
  | { type: 'DRAFT_UPDATED' }
  | { type: 'BLOCK_COMMITTED' }
  | { type: 'STOP_REQUESTED' }
  | { type: 'ENGINE_WARNING'; recoverable: boolean }
  | { type: 'FAILED'; error?: AppErrorPayload }
  | { type: 'SESSION_ENDED' }
  | { type: 'PERSIST_SUCCEEDED' }
  | { type: 'PERSIST_FAILED'; error?: AppErrorPayload }
  | { type: 'RECOVERY_SUCCEEDED' }
  | { type: 'RECOVERY_FAILED'; error?: AppErrorPayload }
  | { type: 'RESET' }
