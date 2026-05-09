import { selectVisibleTimeline, type TranscriptTimelineItem } from '../../../core/transcript/transcript-selectors'
import type { AppRuntimeSnapshot } from '../../../shared/api-types'

export function selectLiveSessionTimeline(runtime: AppRuntimeSnapshot): TranscriptTimelineItem[] {
  return runtime.liveSession ? selectVisibleTimeline(runtime.liveSession.transcript) : []
}
