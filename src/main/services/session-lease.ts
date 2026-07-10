import type { AppErrorPayload, AppRuntimeSnapshot, PttStatus } from '../../shared/api-types'

export type RecognitionLeaseMode = 'ptt' | 'meeting'

export function isPttLeaseHeld(status: PttStatus): boolean {
  return status !== 'idle'
}

export function isMeetingLeaseHeld(liveSession: AppRuntimeSnapshot['liveSession']): boolean {
  return liveSession !== null && liveSession.status !== 'idle'
}

export function resolveRecognitionLease(
  snapshot: Pick<AppRuntimeSnapshot, 'ptt' | 'liveSession'>
): RecognitionLeaseMode | null {
  const pttHeld = isPttLeaseHeld(snapshot.ptt.status)
  const meetingHeld = isMeetingLeaseHeld(snapshot.liveSession)

  if (meetingHeld) {
    return 'meeting'
  }

  if (pttHeld) {
    return 'ptt'
  }

  return null
}

export function assertRecognitionLeaseAvailable(
  snapshot: Pick<AppRuntimeSnapshot, 'ptt' | 'liveSession'>,
  requested: RecognitionLeaseMode
): void {
  const held = resolveRecognitionLease(snapshot)

  if (held === null || held === requested) {
    return
  }

  throw createLeaseConflictError(held, requested)
}

export function createLeaseConflictError(
  held: RecognitionLeaseMode,
  requested: RecognitionLeaseMode
): Error & { payload: AppErrorPayload } {
  const message =
    held === 'meeting' && requested === 'ptt'
      ? 'A live meeting session is already active'
      : held === 'ptt' && requested === 'meeting'
        ? 'A PTT session is already active'
        : 'Another recognition session is already active'

  return Object.assign(new Error(message), {
    payload: {
      code: 'E_CAPTURE_UNAVAILABLE',
      message,
      retryable: false
    }
  })
}
