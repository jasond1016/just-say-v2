import type {
  RecognitionEngine,
  RecognitionEvent,
  StartSessionInput,
  WarmupInput
} from '../../core/contracts/engine'
import type { ResolvedRuntimeConfig } from '../../shared/api-types'
import type {
  LocalServiceClientMessage,
  LocalServiceServerMessage
} from '../../shared/local-service-types'
import { encodeAudioChunkToBase64 } from '../../shared/local-service-types'
import type { WebSocketLike } from '../services/python-local-service-controller'

export type LocalEngineAdapterOptions = {
  ensureLocalServiceReady: () => Promise<unknown>
  webSocketFactory?: (url: string) => WebSocketLike
  connectTimeoutMs?: number
}

export class LocalEngineAdapter implements RecognitionEngine {
  private socket: WebSocketLike | null = null
  private activeSession: StartSessionInput | null = null
  private readonly listeners = new Set<(event: RecognitionEvent) => void>()
  private readonly webSocketFactory: (url: string) => WebSocketLike
  private readonly connectTimeoutMs: number

  constructor(
    private readonly config: ResolvedRuntimeConfig,
    private readonly options: LocalEngineAdapterOptions
  ) {
    this.webSocketFactory = options.webSocketFactory ?? defaultWebSocketFactory
    this.connectTimeoutMs = options.connectTimeoutMs ?? 5_000
  }

  async getCapabilities() {
    return {
      ...this.config.engineProfile.capabilities
    }
  }

  async warmup(_input: WarmupInput): Promise<void> {
    await this.options.ensureLocalServiceReady()
  }

  async startSession(input: StartSessionInput): Promise<void> {
    await this.options.ensureLocalServiceReady()
    const socket = await this.connect(this.getSocketUrl())
    this.socket = socket
    this.activeSession = input

    this.send({
      type: 'start-session',
      sessionId: input.sessionId,
      mode: input.mode,
      language: input.language,
      translationEnabled: input.translation.enabled
    })

    if (input.translation.enabled) {
      this.emit({
        type: 'warning',
        payload: {
          code: 'W_TRANSLATION_DISABLED',
          message: 'Local SenseVoice service is running without cloud translation.',
          recoverable: true
        }
      })
    }
  }

  pushAudio(chunk: Parameters<RecognitionEngine['pushAudio']>[0]): void {
    if (!this.activeSession) {
      return
    }

    this.send({
      type: 'audio-chunk',
      sessionId: this.activeSession.sessionId,
      chunk: {
        source: chunk.source,
        sampleRate: chunk.sampleRate,
        channels: chunk.channels,
        timestamp: chunk.timestamp,
        dataBase64: encodeAudioChunkToBase64(chunk.data)
      }
    })
  }

  async stopSession(): Promise<void> {
    if (!this.activeSession) {
      return
    }

    this.send({
      type: 'stop-session',
      sessionId: this.activeSession.sessionId
    })
  }

  async abortSession(): Promise<void> {
    if (this.activeSession) {
      this.send({
        type: 'abort-session',
        sessionId: this.activeSession.sessionId
      })
    }

    this.socket?.close()
    this.socket = null
    this.activeSession = null
  }

  onEvent(listener: (event: RecognitionEvent) => void): () => void {
    this.listeners.add(listener)

    return () => {
      this.listeners.delete(listener)
    }
  }

  private async connect(url: string): Promise<WebSocketLike> {
    const socket = this.webSocketFactory(url)
    let isOpen = false
    let hasSettled = false

    const waitForOpen = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        hasSettled = true
        socket.close()
        reject(new Error('Timed out waiting for local engine websocket to connect'))
      }, this.connectTimeoutMs)

      const settle = (callback: () => void) => {
        if (hasSettled) {
          return
        }

        hasSettled = true
        clearTimeout(timeout)
        callback()
      }

      socket.addEventListener('open', () => {
        isOpen = true
        settle(resolve)
      })
      socket.addEventListener('error', (event) => {
        const message = normalizeSocketError(event)
        this.emit({
          type: 'error',
          payload: {
            code: 'E_ENGINE_UNAVAILABLE',
            message,
            retryable: true
          }
        })

        if (!isOpen) {
          settle(() => reject(new Error(message)))
        }
      })
      socket.addEventListener('close', () => {
        if (!isOpen) {
          settle(() => reject(new Error('Local engine websocket closed before connecting')))
          return
        }

        if (!this.activeSession) {
          return
        }

        this.emit({
          type: 'session-ended'
        })
        this.activeSession = null
        this.socket = null
      })
    })

    socket.addEventListener('message', (event) => {
      this.handleServerMessage(JSON.parse(event.data) as LocalServiceServerMessage)
    })

    try {
      await waitForOpen
      return socket
    } catch (error) {
      socket.close()
      throw error
    }
  }

  private handleServerMessage(message: LocalServiceServerMessage): void {
    if (message.type === 'health-status') {
      return
    }

    if (this.activeSession && 'sessionId' in message && message.sessionId !== this.activeSession.sessionId) {
      return
    }

    switch (message.type) {
      case 'session-ready':
        this.emit({ type: 'session-ready' })
        return
      case 'draft-updated':
        this.emit({ type: 'draft-updated', payload: message.payload })
        return
      case 'block-committed':
        this.emit({ type: 'block-committed', payload: message.payload })
        return
      case 'warning':
        this.emit({ type: 'warning', payload: message.payload })
        return
      case 'error':
        this.emit({ type: 'error', payload: message.payload })
        return
      case 'session-ended':
        this.emit({ type: 'session-ended' })
        this.activeSession = null
        this.socket?.close()
        this.socket = null
        return
      default:
        return assertNever(message)
    }
  }

  private send(message: LocalServiceClientMessage): void {
    this.socket?.send(JSON.stringify(message))
  }

  private getSocketUrl(): string {
    const localService = this.config.engineConfig.localService as
      | {
          host?: string
          port?: number
        }
      | undefined

    const host = localService?.host ?? '127.0.0.1'
    const port = localService?.port ?? 8765
    return `ws://${host}:${port}`
  }

  private emit(event: RecognitionEvent): void {
    for (const listener of this.listeners) {
      listener(event)
    }
  }
}

function defaultWebSocketFactory(url: string): WebSocketLike {
  return new WebSocket(url) as unknown as WebSocketLike
}

function normalizeSocketError(errorLike: unknown): string {
  if (errorLike instanceof Error) {
    return errorLike.message
  }

  return 'Local engine websocket request failed'
}

function assertNever(value: never): never {
  throw new Error(`Unhandled local service message: ${String(value)}`)
}
