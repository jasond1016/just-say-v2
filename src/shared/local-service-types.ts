import type { AppErrorPayload, EngineCapabilities, TranscriptBlock } from './api-types'
import type { CaptureSource, SessionMode, WordTiming } from './primitive-types'

export type LocalServiceClientMessage =
  | {
      type: 'health-check'
    }
  | {
      type: 'start-session'
      sessionId: string
      mode: SessionMode
      language: string
      translationEnabled: boolean
    }
  | {
      type: 'audio-chunk'
      sessionId: string
      chunk: {
        source: CaptureSource
        sampleRate: number
        channels: 1
        timestamp: number
        dataBase64: string
      }
    }
  | {
      type: 'stop-session'
      sessionId: string
    }
  | {
      type: 'abort-session'
      sessionId: string
    }

export type LocalServiceServerMessage =
  | {
      type: 'health-status'
      ok: boolean
      model: string
      capabilities: EngineCapabilities
      detail?: Record<string, unknown>
    }
  | {
      type: 'session-ready'
      sessionId: string
    }
  | {
      type: 'draft-updated'
      sessionId: string
      payload: {
        blockId: string
        source: CaptureSource
        stableText: string
        previewText: string
        translatedPreviewText?: string
        words?: WordTiming[]
        startedAt: number
        updatedAt: number
      }
    }
  | {
      type: 'block-committed'
      sessionId: string
      payload: {
        block: TranscriptBlock
      }
    }
  | {
      type: 'warning'
      sessionId?: string
      payload: {
        code: string
        message: string
        recoverable: boolean
        detail?: Record<string, unknown>
      }
    }
  | {
      type: 'error'
      sessionId?: string
      payload: AppErrorPayload
    }
  | {
      type: 'session-ended'
      sessionId: string
    }

export function encodeAudioChunkToBase64(data: Uint8Array): string {
  return Buffer.from(data).toString('base64')
}
