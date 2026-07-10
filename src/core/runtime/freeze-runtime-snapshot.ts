import type { AppRuntimeSnapshot } from '../../shared/api-types'
import { cloneTranscriptState } from '../transcript/clone-transcript-state'

export function freezeRuntimeSnapshot(snapshot: AppRuntimeSnapshot): AppRuntimeSnapshot {
  return {
    ...snapshot,
    ptt: {
      ...snapshot.ptt,
      ...(snapshot.ptt.lastResult ? { lastResult: { ...snapshot.ptt.lastResult } } : {})
    },
    liveSession: snapshot.liveSession
      ? {
          ...snapshot.liveSession,
          transcript: cloneTranscriptState(snapshot.liveSession.transcript)
        }
      : null,
    services: {
      ...snapshot.services
    }
  }
}
