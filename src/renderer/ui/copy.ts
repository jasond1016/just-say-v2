import type {
  EngineProfile,
  LocalServiceStatus,
  OutputMethod,
  PttHotkey,
  RuntimeFamilyId,
  PttStatus,
  SavedTranscript
} from '../../shared/api-types'
import type { CaptureSource, SessionMode } from '../../shared/primitive-types'

export function describeCaptureSource(source: CaptureSource): string {
  return source === 'microphone' ? 'Microphone' : 'System audio'
}

export function describeSessionMode(mode: SessionMode): string {
  return mode === 'ptt' ? 'Quick dictation' : 'Live session'
}

export function describeOutputMethod(method: OutputMethod): string {
  switch (method) {
    case 'simulate_input':
      return 'Type into the active app'
    case 'clipboard':
      return 'Copy to the clipboard'
    case 'popup':
      return 'Open the text popup'
    default:
      return method
  }
}

export function describeDeliveredVia(method: OutputMethod): string {
  switch (method) {
    case 'simulate_input':
      return 'typed into the active app'
    case 'clipboard':
      return 'copied to the clipboard'
    case 'popup':
      return 'shown in the text popup'
    default:
      return method
  }
}

export function describePttHotkey(hotkey: PttHotkey): string {
  return hotkey === 'RCtrl' ? 'Right Ctrl' : 'Right Alt'
}

export function describePttStatus(status: PttStatus): string {
  switch (status) {
    case 'idle':
      return 'Ready'
    case 'arming':
      return 'Getting ready'
    case 'capturing':
      return 'Listening'
    case 'recognizing':
      return 'Transcribing'
    case 'post_processing':
      return 'Refining text'
    case 'delivering':
      return 'Sending text'
    case 'completed':
      return 'Done'
    case 'cancelled':
      return 'Cancelled'
    case 'error':
      return 'Needs attention'
    default:
      return status
  }
}

export function isPttStatusActive(status: PttStatus): boolean {
  return status === 'capturing' || status === 'recognizing' || status === 'post_processing' || status === 'delivering'
}

export function describeTimelineKind(kind: 'draft' | 'committed'): string {
  return kind === 'draft' ? 'Listening' : 'Saved'
}

export function describeLocalServiceStatus(status: LocalServiceStatus): string {
  switch (status) {
    case 'healthy':
      return 'Speech service ready'
    case 'starting':
      return 'Speech service starting'
    case 'degraded':
      return 'Speech service reconnecting'
    case 'failed':
      return 'Speech service unavailable'
    case 'stopped':
    default:
      return 'Speech service offline'
  }
}

export function describeProfileLabel(profile: EngineProfile): string {
  switch (profile.preset) {
    case 'local-fast':
      return 'Local Fast'
    case 'local-accurate':
      return 'Local Accurate'
    case 'cloud-low-latency':
      return 'Cloud Low Latency'
    case 'cloud-low-cost':
      return 'Cloud Low Cost'
    default:
      return profile.label
  }
}

export function describeProfileSummary(profile: EngineProfile): string {
  switch (profile.preset) {
    case 'local-fast':
      return 'SenseVoice runtime for the quickest local turnaround.'
    case 'local-accurate':
      return 'Qwen 1.7B runtime for higher accuracy. Check may load it or point you to a remote service.'
    case 'cloud-low-latency':
      return 'Fast cloud preset when low delay matters most.'
    case 'cloud-low-cost':
      return 'Lower-cost cloud preset for lighter workloads.'
    default:
      return profile.label
  }
}

export function describeProfileId(profileId: string): string {
  switch (profileId) {
    case 'local-fast':
      return 'Local Fast'
    case 'local-accurate':
      return 'Local Accurate'
    case 'cloud-low-latency':
      return 'Cloud Low Latency'
    case 'cloud-low-cost':
      return 'Cloud Low Cost'
    default:
      return profileId
  }
}

export function describeTranscriptSummary(transcript: SavedTranscript): string {
  const sources = [...new Set(transcript.blocks.map((block) => describeCaptureSource(block.source)))]
  const sourceLabel = sources.length === 0 ? 'Unknown source' : sources.join(' + ')
  return `${describeSessionMode(transcript.mode)} · ${sourceLabel}`
}

export function describeRuntimeFamily(runtimeFamilyId: RuntimeFamilyId): string {
  switch (runtimeFamilyId) {
    case 'sensevoice':
      return 'SenseVoice'
    case 'qwen3-asr':
      return 'Qwen3 ASR'
    case 'cloud-low-latency':
      return 'Cloud Low Latency'
    case 'cloud-low-cost':
      return 'Cloud Low Cost'
    default:
      return runtimeFamilyId
  }
}

export function describeDeploymentMode(mode: SavedTranscript['metadata']['deploymentMode']): string {
  return mode === 'remote-service' ? 'Remote service' : 'Managed locally'
}
