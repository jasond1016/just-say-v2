import type { WebSocketLike } from './sidecar-protocol'
import { defaultWebSocketFactory } from './sidecar-protocol'

export type RealtimeTurnDetection = 'none' | 'server_vad'

export type RealtimeTranscriptionClientEvent =
  | {
      type: 'session.update'
      session: {
        input_audio_format: 'pcm16'
        turn_detection: {
          type: RealtimeTurnDetection
        }
      }
    }
  | {
      type: 'input_audio_buffer.append'
      audio: string
    }
  | {
      type: 'input_audio_buffer.commit'
    }
  | {
      type: 'input_audio_buffer.clear'
    }

export type RealtimeTranscriptionServerEvent =
  | {
      type: 'session.created'
    }
  | {
      type: 'input_audio_buffer.speech_started'
      audioStartMs: number
    }
  | {
      type: 'input_audio_buffer.speech_stopped'
      audioEndMs?: number
    }
  | {
      type: 'input_audio_buffer.committed'
    }
  | {
      type: 'conversation.item.created'
    }
  | {
      type: 'conversation.item.input_audio_transcription.delta'
      itemId: string
      delta: string
      transcript?: string
    }
  | {
      type: 'conversation.item.input_audio_transcription.completed'
      itemId: string
      transcript: string
      language?: string
    }
  | {
      type: 'error'
      message: string
    }

export type RealtimeTranscriptionStream = {
  send(event: RealtimeTranscriptionClientEvent): void
  close(): void
}

export type OpenAiRealtimeTranscriptionProtocolOptions = {
  webSocketFactory?: (url: string) => WebSocketLike
  connectTimeoutMs?: number
}

export type RealtimeTranscriptionStreamHandlers = {
  onMessage(event: RealtimeTranscriptionServerEvent): void
  onError?(message: string): void
  onClose?(): void
}

export class OpenAiRealtimeTranscriptionProtocol {
  private readonly webSocketFactory: (url: string) => WebSocketLike
  private readonly connectTimeoutMs: number

  constructor(options: OpenAiRealtimeTranscriptionProtocolOptions = {}) {
    this.webSocketFactory = options.webSocketFactory ?? defaultWebSocketFactory
    this.connectTimeoutMs = options.connectTimeoutMs ?? 5_000
  }

  async openSessionStream(
    url: string,
    handlers: RealtimeTranscriptionStreamHandlers
  ): Promise<RealtimeTranscriptionStream> {
    const socket = this.webSocketFactory(url)
    let opened = false
    let settled = false
    let intentionallyClosed = false

    const waitForOpen = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        settle(() => {
          socket.close()
          reject(new Error('Timed out waiting for native SenseVoice websocket to connect'))
        })
      }, this.connectTimeoutMs)

      const settle = (callback: () => void) => {
        if (settled) {
          return
        }

        settled = true
        clearTimeout(timeout)
        callback()
      }

      socket.addEventListener('open', () => {
        opened = true
        settle(resolve)
      })
      socket.addEventListener('error', (errorLike) => {
        const message = normalizeSocketErrorMessage(errorLike)
        handlers.onError?.(message)
        if (!opened) {
          settle(() => reject(new Error(message)))
        }
      })
      socket.addEventListener('close', () => {
        if (!opened) {
          settle(() => reject(new Error('Native SenseVoice websocket closed before connecting')))
          return
        }

        if (!intentionallyClosed) {
          handlers.onClose?.()
        }
      })
    })

    socket.addEventListener('message', (message) => {
      try {
        handlers.onMessage(parseRealtimeTranscriptionServerEvent(message.data))
      } catch (errorLike) {
        handlers.onError?.(
          errorLike instanceof Error
            ? errorLike.message
            : 'Native SenseVoice returned an invalid realtime event'
        )
      }
    })

    try {
      await waitForOpen
    } catch (error) {
      socket.close()
      throw error
    }

    return {
      send(event) {
        socket.send(JSON.stringify(event))
      },
      close() {
        intentionallyClosed = true
        socket.close()
      }
    }
  }
}

export function createOpenAiRealtimeTranscriptionUrl(host: string, port: number): string {
  return `ws://${host}:${port}/v1/realtime?intent=transcription`
}

export function parseRealtimeTranscriptionServerEvent(
  serialized: string
): RealtimeTranscriptionServerEvent {
  const value: unknown = JSON.parse(serialized)
  const event = requireRecord(value, 'realtime event')
  const type = requireString(event.type, 'realtime event type')

  switch (type) {
    case 'session.created':
    case 'input_audio_buffer.committed':
    case 'conversation.item.created':
      return { type }
    case 'input_audio_buffer.speech_started':
      return {
        type,
        audioStartMs: requireNumber(event.audio_start_ms, 'audio_start_ms')
      }
    case 'input_audio_buffer.speech_stopped': {
      const audioEndMs = optionalNumber(event.audio_end_ms, 'audio_end_ms')
      return {
        type,
        ...(audioEndMs !== undefined ? { audioEndMs } : {})
      }
    }
    case 'conversation.item.input_audio_transcription.delta': {
      const transcript = optionalString(event.transcript, 'transcript')
      return {
        type,
        itemId: requireString(event.item_id, 'item_id'),
        delta: requireString(event.delta, 'delta'),
        ...(transcript !== undefined ? { transcript } : {})
      }
    }
    case 'conversation.item.input_audio_transcription.completed': {
      const language = optionalString(event.language, 'language')
      return {
        type,
        itemId: requireString(event.item_id, 'item_id'),
        transcript: requireString(event.transcript, 'transcript'),
        ...(language !== undefined ? { language } : {})
      }
    }
    case 'error':
      return {
        type,
        message: typeof event.message === 'string' ? event.message : 'Native SenseVoice error'
      }
    default:
      throw new Error(`Unsupported native SenseVoice realtime event: ${type}`)
  }
}

function requireRecord(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid ${name}`)
  }

  return value as Record<string, unknown>
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string') {
    throw new Error(`Invalid ${name}`)
  }

  return value
}

function optionalString(value: unknown, name: string): string | undefined {
  if (value === undefined) {
    return undefined
  }

  return requireString(value, name)
}

function requireNumber(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Invalid ${name}`)
  }

  return value
}

function optionalNumber(value: unknown, name: string): number | undefined {
  if (value === undefined) {
    return undefined
  }

  return requireNumber(value, name)
}

function normalizeSocketErrorMessage(errorLike: unknown): string {
  return errorLike instanceof Error
    ? errorLike.message
    : 'Native SenseVoice websocket request failed'
}
