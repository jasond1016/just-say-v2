import type {
  RecognitionEngine,
  RecognitionEvent,
  StartSessionInput,
  WarmupInput
} from '../../core/contracts/engine'
import type { ResolvedRuntimeConfig } from '../../shared/api-types'
import type { LocalServiceServerMessage } from '../../shared/local-service-types'
import { encodeAudioChunkToBase64 } from '../../shared/local-service-types'
import {
  createLocalServiceUrl,
  SidecarProtocol,
  type SidecarSessionStream,
  type WebSocketLike
} from '../services/sidecar-protocol'
import type { RuntimeReadinessEstablishmentResult } from '../services/runtime-readiness'

export type LocalEngineAdapterOptions = {
  establishReadiness: (input: WarmupInput) => Promise<RuntimeReadinessEstablishmentResult>
  webSocketFactory?: (url: string) => WebSocketLike
  connectTimeoutMs?: number
  sidecarProtocol?: SidecarProtocol
}

export class LocalEngineAdapter implements RecognitionEngine {
  private stream: SidecarSessionStream | null = null
  private activeSession: StartSessionInput | null = null
  private readonly listeners = new Set<(event: RecognitionEvent) => void>()
  private readonly protocol: SidecarProtocol

  constructor(
    private readonly config: ResolvedRuntimeConfig,
    private readonly options: LocalEngineAdapterOptions
  ) {
    this.protocol =
      options.sidecarProtocol ??
      new SidecarProtocol({
        ...(options.webSocketFactory !== undefined
          ? { webSocketFactory: options.webSocketFactory }
          : {}),
        ...(options.connectTimeoutMs !== undefined
          ? { connectTimeoutMs: options.connectTimeoutMs }
          : {})
      })
  }

  async getCapabilities() {
    return {
      ...this.config.engineProfile.capabilities
    }
  }

  async warmup(input: WarmupInput): Promise<void> {
    const result = await this.options.establishReadiness(input)

    if (!result.health.ok) {
      throw new Error('Local service reported unhealthy during prewarm')
    }
  }

  async startSession(input: StartSessionInput): Promise<void> {
    await this.warmup({
      mode: input.mode,
      language: input.language
    })
    this.stream = await this.protocol.openSessionStream(this.getSocketUrl(), {
      onMessage: (message) => {
        this.handleServerMessage(message)
      },
      onError: (message) => {
        this.emit({
          type: 'error',
          payload: {
            code: 'E_ENGINE_UNAVAILABLE',
            message,
            retryable: true
          }
        })
      },
      onClose: () => {
        if (!this.activeSession) {
          return
        }

        this.emit({
          type: 'session-ended'
        })
        this.activeSession = null
        this.stream = null
      }
    })
    this.activeSession = input
    const nativeTranslationEnabled = input.translation.enabled && this.config.engineProfile.capabilities.translation

    this.stream.send({
      type: 'start-session',
      sessionId: input.sessionId,
      mode: input.mode,
      language: input.language,
      translationEnabled: nativeTranslationEnabled
    })
  }

  pushAudio(chunk: Parameters<RecognitionEngine['pushAudio']>[0]): void {
    if (!this.activeSession) {
      return
    }

    this.stream?.send({
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

    this.stream?.send({
      type: 'stop-session',
      sessionId: this.activeSession.sessionId
    })
  }

  async abortSession(): Promise<void> {
    if (this.activeSession) {
      this.stream?.send({
        type: 'abort-session',
        sessionId: this.activeSession.sessionId
      })
    }

    this.stream?.close()
    this.stream = null
    this.activeSession = null
  }

  onEvent(listener: (event: RecognitionEvent) => void): () => void {
    this.listeners.add(listener)

    return () => {
      this.listeners.delete(listener)
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
        this.stream?.close()
        this.stream = null
        return
      case 'prewarm-complete':
        return
      default:
        return assertNever(message)
    }
  }

  private getSocketUrl(): string {
    const localService = this.config.engineConfig.localService
    const host = localService?.host ?? '127.0.0.1'
    const port = localService?.port ?? 8765
    return createLocalServiceUrl(host, port)
  }

  private emit(event: RecognitionEvent): void {
    for (const listener of this.listeners) {
      listener(event)
    }
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled local service message: ${String(value)}`)
}
