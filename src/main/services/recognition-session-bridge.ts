import type { RecognitionEngine, RecognitionEvent } from '../../core/contracts/engine'
import type { CaptureEvent, ResolvedRuntimeConfig } from '../../shared/api-types'
import type { CaptureSource, SessionMode } from '../../shared/primitive-types'
import type { CaptureWindowService } from '../platform/capture-window-service'
import {
  abortRecognitionSession,
  attachRecognitionEngine,
  normalizeRecognitionError,
  startRecognitionSession,
  stopRecognitionCapture
} from './recognition-session-runtime'

export { normalizeRecognitionError }

export type RecognitionCaptureControlEvent = Exclude<CaptureEvent, { type: 'audio-chunk' }>

export type RecognitionSessionHandlers = {
  onEngineEvent: (event: RecognitionEvent) => void | Promise<void>
  onCaptureEvent: (event: RecognitionCaptureControlEvent) => void | Promise<void>
  onAudioChunk?: (chunk: Extract<CaptureEvent, { type: 'audio-chunk' }>['chunk']) => void
}

export type BindRecognitionSessionInput = {
  engine: RecognitionEngine
  sessionId: string
  handlers: RecognitionSessionHandlers
}

export type RecognitionSessionStartInput = {
  mode: SessionMode
  sources: CaptureSource[]
  runtimeConfig: ResolvedRuntimeConfig
  microphoneDeviceId?: string
  explicitWarmup?: boolean
  startCapture?: boolean
}

type RecognitionSessionLinkage = {
  engine: RecognitionEngine
  sessionId: string
  handlers: RecognitionSessionHandlers
  engineUnsubscribe: () => void
}

/**
 * Owns the Recognition Session linkage: engine subscription, capture routing,
 * and start/stop/abort. Mode-specific policy stays in the coordinator callbacks.
 */
export class RecognitionSessionBridge {
  private linkage: RecognitionSessionLinkage | null = null
  private readonly captureUnsubscribe: () => void

  constructor(private readonly captureWindowService: CaptureWindowService) {
    this.captureUnsubscribe = this.captureWindowService.onEvent((event) => {
      this.handleCaptureEvent(event)
    })
  }

  get sessionId(): string | null {
    return this.linkage?.sessionId ?? null
  }

  get engine(): RecognitionEngine | null {
    return this.linkage?.engine ?? null
  }

  get isBound(): boolean {
    return this.linkage !== null
  }

  bind(input: BindRecognitionSessionInput): void {
    this.clearEngineSubscription()
    this.linkage = {
      engine: input.engine,
      sessionId: input.sessionId,
      handlers: input.handlers,
      engineUnsubscribe: attachRecognitionEngine(input.engine, (event) => {
        void input.handlers.onEngineEvent(event)
      })
    }
  }

  rebind(engine: RecognitionEngine): void {
    const linkage = this.requireLinkage('Cannot rebind Recognition Session before bind')
    linkage.engineUnsubscribe()
    linkage.engine = engine
    linkage.engineUnsubscribe = attachRecognitionEngine(engine, (event) => {
      void linkage.handlers.onEngineEvent(event)
    })
  }

  clear(): void {
    this.clearEngineSubscription()
    this.linkage = null
  }

  dispose(): void {
    this.clear()
    this.captureUnsubscribe()
  }

  async start(input: RecognitionSessionStartInput): Promise<void> {
    const linkage = this.requireLinkage('Cannot start Recognition Session before bind')

    await startRecognitionSession({
      engine: linkage.engine,
      captureWindowService: this.captureWindowService,
      sessionId: linkage.sessionId,
      mode: input.mode,
      sources: input.sources,
      runtimeConfig: input.runtimeConfig,
      ...(input.microphoneDeviceId !== undefined
        ? { microphoneDeviceId: input.microphoneDeviceId }
        : {}),
      ...(input.explicitWarmup !== undefined ? { explicitWarmup: input.explicitWarmup } : {}),
      ...(input.startCapture !== undefined ? { startCapture: input.startCapture } : {})
    })
  }

  async stopCapture(): Promise<boolean> {
    const linkage = this.requireLinkage('Cannot stop capture before Recognition Session bind')
    return stopRecognitionCapture(this.captureWindowService, linkage.sessionId)
  }

  async stopSession(): Promise<void> {
    const linkage = this.requireLinkage('Cannot stop engine session before Recognition Session bind')
    await linkage.engine.stopSession()
  }

  async abort(options: { abortCapture?: boolean } = {}): Promise<void> {
    const linkage = this.linkage

    await abortRecognitionSession({
      engine: linkage?.engine ?? null,
      captureWindowService: this.captureWindowService,
      ...(linkage?.sessionId !== undefined ? { sessionId: linkage.sessionId } : {}),
      ...(options.abortCapture !== undefined ? { abortCapture: options.abortCapture } : {})
    })
  }

  private handleCaptureEvent(event: CaptureEvent): void {
    const linkage = this.linkage

    if (!linkage || event.requestId !== linkage.sessionId) {
      return
    }

    if (event.type === 'audio-chunk') {
      linkage.engine.pushAudio(event.chunk)
      linkage.handlers.onAudioChunk?.(event.chunk)
      return
    }

    void linkage.handlers.onCaptureEvent(event)
  }

  private clearEngineSubscription(): void {
    this.linkage?.engineUnsubscribe()
  }

  private requireLinkage(message: string): RecognitionSessionLinkage {
    if (!this.linkage) {
      throw new Error(message)
    }

    return this.linkage
  }
}
