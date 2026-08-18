import type {
  RecognitionEngine,
  RecognitionEvent,
  StartSessionInput,
  WarmupInput
} from '../../core/contracts/engine'
import type { AudioChunk, ResolvedRuntimeConfig } from '../../shared/api-types'
import type { CaptureSource } from '../../shared/primitive-types'
import {
  createOpenAiRealtimeTranscriptionUrl,
  OpenAiRealtimeTranscriptionProtocol,
  type RealtimeTranscriptionServerEvent,
  type RealtimeTranscriptionStream
} from '../services/openai-realtime-transcription-protocol'
import type { RuntimeReadinessEstablishmentResult } from '../services/runtime-readiness'
import type { WebSocketLike } from '../services/sidecar-protocol'

const REQUIRED_SAMPLE_RATE = 16_000
const MIN_TRANSCRIBABLE_SAMPLES = 400

type ActiveBlock = {
  id: string
  startedAt: number
  endedAt?: number
  hypothesis: string
}

export type SenseVoiceRealtimeEngineAdapterOptions = {
  establishReadiness(input: WarmupInput): Promise<RuntimeReadinessEstablishmentResult>
  webSocketFactory?: (url: string) => WebSocketLike
  connectTimeoutMs?: number
  stopTimeoutMs?: number
  protocol?: OpenAiRealtimeTranscriptionProtocol
}

export class SenseVoiceRealtimeEngineAdapter implements RecognitionEngine {
  private readonly listeners = new Set<(event: RecognitionEvent) => void>()
  private readonly protocol: OpenAiRealtimeTranscriptionProtocol
  private readonly stopTimeoutMs: number
  private stream: RealtimeTranscriptionStream | null = null
  private activeSession: StartSessionInput | null = null
  private source: CaptureSource | null = null
  private sessionEpoch: number | null = null
  private audioSamplesSent = 0
  private blockSequence = 0
  private activeBlock: ActiveBlock | null = null
  private stopping = false
  private stopTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly config: ResolvedRuntimeConfig,
    private readonly options: SenseVoiceRealtimeEngineAdapterOptions
  ) {
    this.stopTimeoutMs = options.stopTimeoutMs ?? 15_000
    this.protocol =
      options.protocol ??
      new OpenAiRealtimeTranscriptionProtocol({
        ...(options.webSocketFactory !== undefined
          ? { webSocketFactory: options.webSocketFactory }
          : {}),
        ...(options.connectTimeoutMs !== undefined
          ? { connectTimeoutMs: options.connectTimeoutMs }
          : {})
      })
  }

  async getCapabilities() {
    return { ...this.config.engineProfile.capabilities }
  }

  async warmup(input: WarmupInput): Promise<void> {
    const result = await this.options.establishReadiness(input)
    if (!result.health.ok) {
      throw new Error('Native SenseVoice service reported unhealthy during prewarm')
    }
  }

  async startSession(input: StartSessionInput): Promise<void> {
    if (input.sources.length !== 1 || input.sources[0] === undefined) {
      throw createEngineError(
        'Native SenseVoice validation currently supports one capture source per session'
      )
    }

    await this.warmup({ mode: input.mode, language: input.language })
    this.resetSessionState()
    this.activeSession = input
    this.source = input.sources[0]

    try {
      this.stream = await this.protocol.openSessionStream(this.getSocketUrl(), {
        onMessage: (event) => {
          this.handleServerEvent(event)
        },
        onError: (message) => {
          this.emit({
            type: 'error',
            payload: {
              code: 'E_ENGINE_PROTOCOL',
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
            type: 'error',
            payload: {
              code: 'E_ENGINE_UNAVAILABLE',
              message: 'Native SenseVoice websocket closed unexpectedly',
              retryable: true
            }
          })
          this.finishSession()
        }
      })
    } catch (error) {
      this.resetSessionState()
      throw error
    }

    this.stream.send({
      type: 'session.update',
      session: {
        input_audio_format: 'pcm16',
        turn_detection: {
          type: input.mode === 'ptt' ? 'none' : 'server_vad'
        }
      }
    })
    this.emit({ type: 'session-ready' })
  }

  pushAudio(chunk: AudioChunk): void {
    if (!this.activeSession || !this.stream || !this.source) {
      return
    }

    if (
      chunk.source !== this.source ||
      chunk.sampleRate !== REQUIRED_SAMPLE_RATE ||
      chunk.channels !== 1 ||
      chunk.data.byteLength % 2 !== 0
    ) {
      this.emit({
        type: 'error',
        payload: {
          code: 'E_ENGINE_PROTOCOL',
          message: 'Native SenseVoice requires matching-source 16 kHz mono PCM16 audio',
          retryable: false
        }
      })
      return
    }

    const sampleCount = chunk.data.byteLength / 2
    if (this.sessionEpoch === null) {
      const chunkDurationMs = (sampleCount / REQUIRED_SAMPLE_RATE) * 1_000
      this.sessionEpoch = chunk.timestamp - chunkDurationMs
    }
    this.audioSamplesSent += sampleCount
    this.stream.send({
      type: 'input_audio_buffer.append',
      audio: Buffer.from(chunk.data).toString('base64')
    })
  }

  async stopSession(): Promise<void> {
    if (!this.activeSession || !this.stream) {
      return
    }

    this.stopping = true
    const needsFinal =
      this.activeSession.mode === 'ptt'
        ? this.audioSamplesSent >= MIN_TRANSCRIBABLE_SAMPLES
        : this.activeBlock !== null

    if (!needsFinal) {
      this.finishSession()
      return
    }

    this.stream.send({ type: 'input_audio_buffer.commit' })
    this.stopTimer = setTimeout(() => {
      this.emit({
        type: 'error',
        payload: {
          code: 'E_ENGINE_TIMEOUT',
          message: 'Timed out waiting for native SenseVoice to finalize the last utterance',
          retryable: true
        }
      })
      this.finishSession()
    }, this.stopTimeoutMs)
  }

  async abortSession(): Promise<void> {
    this.stream?.send({ type: 'input_audio_buffer.clear' })
    this.stream?.close()
    this.resetSessionState()
  }

  onEvent(listener: (event: RecognitionEvent) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private handleServerEvent(event: RealtimeTranscriptionServerEvent): void {
    switch (event.type) {
      case 'session.created':
      case 'input_audio_buffer.committed':
      case 'conversation.item.created':
        return
      case 'input_audio_buffer.speech_started': {
        const block = this.ensureActiveBlock()
        block.startedAt = this.toAbsoluteTime(event.audioStartMs)
        return
      }
      case 'input_audio_buffer.speech_stopped':
        if (this.activeBlock) {
          this.activeBlock.endedAt =
            event.audioEndMs !== undefined
              ? this.toAbsoluteTime(event.audioEndMs)
              : this.getCurrentAudioEndTime()
        }
        return
      case 'conversation.item.input_audio_transcription.delta': {
        const block = this.ensureActiveBlock()
        block.hypothesis =
          event.transcript ?? mergeUnpatchedSenseVoiceDelta(block.hypothesis, event.delta)
        this.emit({
          type: 'draft-updated',
          payload: {
            blockId: block.id,
            source: this.requireSource(),
            stableText: '',
            previewText: block.hypothesis,
            startedAt: block.startedAt,
            updatedAt: this.getCurrentAudioEndTime()
          }
        })
        return
      }
      case 'conversation.item.input_audio_transcription.completed': {
        const block = this.ensureActiveBlock()
        const transcript = event.transcript.trim()
        if (transcript) {
          this.emit({
            type: 'block-committed',
            payload: {
              block: {
                id: block.id,
                source: this.requireSource(),
                text: transcript,
                startedAt: block.startedAt,
                endedAt: block.endedAt ?? this.getCurrentAudioEndTime()
              }
            }
          })
        }
        this.activeBlock = null
        if (this.stopping) {
          this.finishSession()
        }
        return
      }
      case 'error':
        this.emit({
          type: 'error',
          payload: {
            code: 'E_ENGINE_PROTOCOL',
            message: event.message,
            retryable: true
          }
        })
        return
      default:
        return assertNever(event)
    }
  }

  private ensureActiveBlock(): ActiveBlock {
    if (this.activeBlock) {
      return this.activeBlock
    }

    this.blockSequence += 1
    this.activeBlock = {
      id: `${this.activeSession?.sessionId ?? 'sensevoice'}:${this.requireSource()}:${this.blockSequence}`,
      startedAt: this.sessionEpoch ?? Date.now(),
      hypothesis: ''
    }
    return this.activeBlock
  }

  private requireSource(): CaptureSource {
    if (!this.source) {
      throw new Error('Native SenseVoice capture source is unavailable')
    }
    return this.source
  }

  private toAbsoluteTime(relativeMs: number): number {
    return (this.sessionEpoch ?? Date.now()) + relativeMs
  }

  private getCurrentAudioEndTime(): number {
    return (
      (this.sessionEpoch ?? Date.now()) +
      (this.audioSamplesSent / REQUIRED_SAMPLE_RATE) * 1_000
    )
  }

  private getSocketUrl(): string {
    const localService = this.config.engineConfig.localService
    return createOpenAiRealtimeTranscriptionUrl(
      localService?.host ?? '127.0.0.1',
      localService?.port ?? 8765
    )
  }

  private finishSession(): void {
    if (!this.activeSession) {
      return
    }

    this.clearStopTimer()
    this.stream?.close()
    this.emit({ type: 'session-ended' })
    this.resetSessionState()
  }

  private resetSessionState(): void {
    this.clearStopTimer()
    this.stream = null
    this.activeSession = null
    this.source = null
    this.sessionEpoch = null
    this.audioSamplesSent = 0
    this.blockSequence = 0
    this.activeBlock = null
    this.stopping = false
  }

  private clearStopTimer(): void {
    if (this.stopTimer) {
      clearTimeout(this.stopTimer)
      this.stopTimer = null
    }
  }

  private emit(event: RecognitionEvent): void {
    for (const listener of this.listeners) {
      listener(event)
    }
  }
}

export function mergeUnpatchedSenseVoiceDelta(knownText: string, delta: string): string {
  if (!delta) {
    return knownText
  }
  if (delta.startsWith(knownText)) {
    return delta
  }
  return knownText + delta
}

function createEngineError(message: string): Error {
  const error = new Error(message)
  ;(error as Error & { payload?: { code: string; message: string; retryable: boolean } }).payload = {
    code: 'E_ENGINE_UNAVAILABLE',
    message,
    retryable: false
  }
  return error
}

function assertNever(value: never): never {
  throw new Error(`Unhandled native SenseVoice event: ${String(value)}`)
}
