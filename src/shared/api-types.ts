import type { CaptureSource, SessionMode, WordTiming } from './primitive-types'

export type EngineProfilePreset =
  | 'local-fast'
  | 'local-accurate'
  | 'cloud-low-latency'
  | 'cloud-low-cost'

export type AppLanguage = 'zh-CN' | 'en-US'

export type ThemeSetting = 'system' | 'light' | 'dark'

export type SpeechLanguage = 'auto' | 'zh' | 'en' | 'ja' | 'ko'

export type PttHotkey = 'RCtrl' | 'RAlt'

export type OutputMethod = 'simulate_input' | 'clipboard' | 'popup'

export type TranslationProvider = 'openai-compatible'

export type DeepPartial<T> = {
  [Key in keyof T]?: T[Key] extends readonly (infer Item)[]
    ? Item[]
    : T[Key] extends object
      ? DeepPartial<T[Key]>
      : T[Key]
}

export type AudioChunk = {
  source: CaptureSource
  data: Uint8Array
  sampleRate: number
  channels: 1
  timestamp: number
}

export type EngineCapabilities = {
  streaming: boolean
  translation: boolean
  wordTiming: boolean
  speakerSeparation: boolean
  requiresNetwork: boolean
  requiresLocalService: boolean
}

export type EngineProfile = {
  id: string
  label: string
  kind: 'local' | 'cloud'
  capabilities: EngineCapabilities
  preset: EngineProfilePreset
}

export type LocalServiceStatus = 'stopped' | 'starting' | 'healthy' | 'degraded' | 'failed'

export type TranscriptBlock = {
  id: string
  source: CaptureSource
  speakerLabel?: string
  text: string
  translatedText?: string
  startedAt: number
  endedAt: number
  words?: WordTiming[]
}

export type TranscriptBlockDraft = {
  id: string
  source: CaptureSource
  speakerLabel?: string
  stableText: string
  previewText: string
  translatedPreviewText?: string
  startedAt: number
  updatedAt: number
  words?: WordTiming[]
}

export type TranscriptState = {
  committedBlocks: TranscriptBlock[]
  activeDrafts: Partial<Record<CaptureSource, TranscriptBlockDraft>>
  revision: number
}

export type PttStatus =
  | 'idle'
  | 'arming'
  | 'capturing'
  | 'recognizing'
  | 'post_processing'
  | 'delivering'
  | 'completed'
  | 'cancelled'
  | 'error'

export type MeetingStatus =
  | 'idle'
  | 'preparing'
  | 'streaming'
  | 'finishing'
  | 'persisting'
  | 'completed'
  | 'recovering'
  | 'stopped_unexpectedly'
  | 'error'

export type EngineWarningPayload = {
  code: string
  message: string
  recoverable: boolean
  detail?: Record<string, unknown>
}

export type AppErrorCode =
  | 'E_CAPTURE_PERMISSION'
  | 'E_CAPTURE_UNAVAILABLE'
  | 'E_ENGINE_UNAVAILABLE'
  | 'E_ENGINE_TIMEOUT'
  | 'E_ENGINE_PROTOCOL'
  | 'E_TRANSLATION_FAILED'
  | 'E_OUTPUT_DELIVERY'
  | 'E_STORAGE_WRITE'
  | 'E_INVALID_SETTINGS'
  | 'E_LOCAL_SERVICE_START'

export type AppErrorPayload = {
  code: AppErrorCode
  message: string
  retryable: boolean
  detail?: Record<string, unknown>
}

export type CaptureCommand =
  | {
      type: 'start'
      requestId: string
      sources: CaptureSource[]
      microphoneDeviceId?: string
      systemSourceId?: string
      sampleRate: number
      chunkMs: number
    }
  | {
      type: 'stop'
      requestId: string
    }
  | {
      type: 'abort'
      requestId: string
    }

export type CaptureEvent =
  | {
      type: 'capture-started'
      requestId: string
      sources: CaptureSource[]
    }
  | {
      type: 'capture-stopped'
      requestId: string
    }
  | {
      type: 'capture-error'
      requestId: string
      error: AppErrorPayload
    }
  | {
      type: 'audio-chunk'
      requestId: string
      chunk: AudioChunk
    }

export type AppSettings = {
  general: {
    language: AppLanguage
    theme: ThemeSetting
    launchAtLogin: boolean
    minimizeToTray: boolean
  }
  speech: {
    selectedProfileId: string
    language: SpeechLanguage
  }
  input: {
    pttHotkey: PttHotkey
    includeMicrophoneInMeeting: boolean
    microphoneDeviceId: string | 'default'
  }
  output: {
    method: OutputMethod
  }
  translation: {
    enabledForPtt: boolean
    enabledForMeeting: boolean
    targetLanguage: string
    provider: TranslationProvider
  }
  advanced: {
    localServiceHost?: string
    localServicePort?: number
    diagnosticsEnabled: boolean
    experimentalFlags: string[]
  }
}

export type SettingsPatch = DeepPartial<AppSettings>

export type TranslationRuntimeConfig = {
  provider: TranslationProvider
  targetLanguage: string
  sourceLanguage: SpeechLanguage
  credentials: {
    translationApiKey: string
  }
}

export type ResolvedRuntimeConfig = {
  engineProfile: EngineProfile
  engineConfig: Record<string, unknown>
  translationConfig?: TranslationRuntimeConfig
  captureConfig: {
    sampleRate: 16000
    chunkMs: 100
  }
  outputConfig: {
    method: OutputMethod
  }
}

export type SavedTranscript = {
  id: string
  mode: SessionMode
  title: string
  startedAt: number
  endedAt: number
  language?: string
  targetLanguage?: string
  plainText: string
  translatedPlainText?: string
  blocks: TranscriptBlock[]
  metadata: {
    engineProfileId: string
    includeMicrophone: boolean
    translationEnabled: boolean
  }
}

export type HistoryListQuery = {
  page?: number
  pageSize?: number
  mode?: SessionMode
  startedAfter?: number
  source?: CaptureSource
}

export type HistorySearchQuery = HistoryListQuery & {
  query: string
}

export type PaginatedHistoryResult = {
  items: SavedTranscript[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export type ExportFormat = 'plain_text' | 'bilingual_text' | 'json'

export type ExportResult = {
  ok: boolean
  path?: string
  error?: string
}

export type ProfileTestResult = {
  ok: boolean
  profileId: string
  capabilities?: EngineCapabilities
  localService?: LocalServiceStatus
  error?: AppErrorPayload
}

export type StartMeetingCommand = {
  includeMicrophone?: boolean
  translationEnabled?: boolean
  targetLanguage?: string
}

export type RuntimeNotification = {
  level: 'info' | 'warning' | 'error'
  message: string
}

export type AppRuntimeSnapshot = {
  ptt: {
    status: PttStatus
    lastResult?: {
      text: string
      deliveredAt: number
      deliveryMethod: 'simulate_input' | 'clipboard' | 'popup'
    }
    error?: AppErrorPayload
  }
  liveSession: {
    sessionId: string
    status: MeetingStatus
    startedAt: number | null
    durationSec: number
    transcript: TranscriptState
    engineProfileId: string
    translationEnabled: boolean
  } | null
  services: {
    localService: LocalServiceStatus
  }
}

export type DiagnosticEvent =
  | {
      type: 'session-started'
      timestamp: number
      sessionId: string
      mode: SessionMode
    }
  | {
      type: 'capture-started'
      timestamp: number
      sessionId: string
      sources: CaptureSource[]
    }
  | {
      type: 'engine-ready'
      timestamp: number
      sessionId: string
      profileId: string
    }
  | {
      type: 'draft-received'
      timestamp: number
      sessionId: string
      source: CaptureSource
      chars: number
    }
  | {
      type: 'block-committed'
      timestamp: number
      sessionId: string
      blockId: string
      chars: number
    }
  | {
      type: 'translation-failed'
      timestamp: number
      sessionId: string
      reason: string
    }
  | {
      type: 'session-persisted'
      timestamp: number
      sessionId: string
      blockCount: number
    }
  | {
      type: 'session-failed'
      timestamp: number
      sessionId: string
      errorCode: AppErrorCode
    }

export type DiagnosticBundle = {
  appVersion: string
  generatedAt: number
  selectedProfileId: string
  localService: LocalServiceStatus
  recentEvents: DiagnosticEvent[]
  latestFailedSession?: AppRuntimeSnapshot
}

export type DiagnosticBundleResult = {
  ok: boolean
  path?: string
  error?: string
}
