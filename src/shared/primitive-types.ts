export type SessionMode = 'ptt' | 'meeting'

export type CaptureSource = 'microphone' | 'system'

export type EngineKind = 'local' | 'cloud'

export interface WordTiming {
  text: string
  startMs: number
  endMs: number
}
