import type {
  AppErrorPayload,
  AppSettings,
  OutputMethod,
  ResolvedRuntimeConfig,
  SavedTranscript
} from '../../shared/api-types'
import type { SessionMode } from '../../shared/primitive-types'
import type {
  RecognitionEngine,
  RecognitionEvent,
  TranslationUpdatedPayload
} from '../../core/contracts/engine'
import { transitionPttStatus } from '../../core/session/session-machine'
import type { CaptureWindowService } from '../platform/capture-window-service'

export type PttRuntimeSnapshot = {
  status:
    | 'idle'
    | 'arming'
    | 'capturing'
    | 'recognizing'
    | 'post_processing'
    | 'delivering'
    | 'completed'
    | 'cancelled'
    | 'error'
  lastResult?: {
    text: string
    deliveredAt: number
    deliveryMethod: OutputMethod
  }
  error?: AppErrorPayload
}

export interface SettingsProvider {
  getSettings(): AppSettings
  resolveRuntimeConfig(mode: SessionMode): ResolvedRuntimeConfig
}

export interface TranscriptRepositoryLike {
  save(transcript: SavedTranscript): Promise<void>
}

export interface OutputDispatcherLike {
  deliver(input: { text: string; method: OutputMethod }): Promise<void>
}

export type PttCoordinatorDependencies = {
  settingsProvider: SettingsProvider
  engineFactory: (config: ResolvedRuntimeConfig) => RecognitionEngine
  captureWindowService: CaptureWindowService
  transcriptRepository: TranscriptRepositoryLike
  outputDispatcher: OutputDispatcherLike
  now?: () => number
  createSessionId?: () => string
}

type PttSessionContext = {
  sessionId: string
  startedAt: number
  settings: AppSettings
  runtimeConfig: ResolvedRuntimeConfig
  engine: RecognitionEngine
  stopCapturePromise: Promise<boolean> | null
  finalText: string | null
  translatedText: string | null
  completion: {
    promise: Promise<void>
    settle: () => void
  }
}

export class PttCoordinator {
  private readonly now: () => number
  private readonly createSessionId: () => string
  private status: PttRuntimeSnapshot['status'] = 'idle'
  private lastResult: PttRuntimeSnapshot['lastResult']
  private error: AppErrorPayload | undefined
  private activeSession: PttSessionContext | null = null
  private activeEngineUnsubscribe: (() => void) | null = null
  private readonly listeners = new Set<(snapshot: PttRuntimeSnapshot) => void>()

  constructor(private readonly dependencies: PttCoordinatorDependencies) {
    this.now = dependencies.now ?? Date.now
    this.createSessionId = dependencies.createSessionId ?? (() => `ptt-${this.now()}`)
  }

  getSnapshot(): PttRuntimeSnapshot {
    return {
      status: this.status,
      ...(this.lastResult ? { lastResult: { ...this.lastResult } } : {}),
      ...(this.error ? { error: { ...this.error } } : {})
    }
  }

  onSnapshot(listener: (snapshot: PttRuntimeSnapshot) => void): () => void {
    this.listeners.add(listener)

    return () => {
      this.listeners.delete(listener)
    }
  }

  async prewarm(): Promise<void> {
    const runtimeConfig = this.dependencies.settingsProvider.resolveRuntimeConfig('ptt')
    const engine = this.dependencies.engineFactory(runtimeConfig)
    await engine.warmup({
      mode: 'ptt',
      language: String(runtimeConfig.engineConfig.language)
    })
  }

  async start(): Promise<void> {
    if (this.activeSession || this.status !== 'idle') {
      throw new Error('PTT session is already active')
    }

    this.transition({ type: 'PTT_HOTKEY_DOWN' })

    const settings = this.dependencies.settingsProvider.getSettings()
    const runtimeConfig = this.dependencies.settingsProvider.resolveRuntimeConfig('ptt')
    const engine = this.dependencies.engineFactory(runtimeConfig)
    const sessionId = this.createSessionId()
    const startedAt = this.now()

    this.activeSession = {
      sessionId,
      startedAt,
      settings,
      runtimeConfig,
      engine,
      stopCapturePromise: null,
      finalText: null,
      translatedText: null,
      completion: createCompletionSignal()
    }

    this.activeEngineUnsubscribe = engine.onEvent((event) => {
      void this.handleEngineEvent(event)
    })

    try {
      await engine.startSession({
        sessionId,
        mode: 'ptt',
        sources: ['microphone'],
        language: String(runtimeConfig.engineConfig.language),
        translation: {
          enabled: Boolean(runtimeConfig.translationConfig),
          ...(runtimeConfig.translationConfig
            ? {
                targetLanguage: String(runtimeConfig.translationConfig.targetLanguage)
              }
            : {})
        }
      })

      await this.dependencies.captureWindowService.startCapture({
        requestId: sessionId,
        sources: ['microphone'],
        microphoneDeviceId: settings.input.microphoneDeviceId,
        sampleRate: runtimeConfig.captureConfig.sampleRate,
        chunkMs: runtimeConfig.captureConfig.chunkMs
      })

      this.transition({ type: 'CAPTURE_STARTED' })
    } catch (error) {
      await this.fail(error)
      throw error
    }
  }

  async stop(): Promise<void> {
    const session = this.requireActiveSession()

    if (this.status !== 'capturing') {
      throw new Error(`Cannot stop PTT session from status "${this.status}"`)
    }

    this.transition({ type: 'PTT_HOTKEY_UP' })
    session.stopCapturePromise = this.dependencies.captureWindowService.stopCapture(session.sessionId)
    await session.engine.stopSession()
    await session.completion.promise
  }

  private async handleEngineEvent(event: RecognitionEvent): Promise<void> {
    const session = this.activeSession

    if (!session) {
      return
    }

    try {
      switch (event.type) {
        case 'session-ready':
        case 'draft-updated':
        case 'warning':
        case 'session-ended':
          return
        case 'error':
          await this.fail(event.payload)
          return
        case 'block-committed':
          session.finalText = event.payload.block.text
          if (this.status === 'recognizing') {
            this.transition({ type: 'BLOCK_COMMITTED' })
          }

          if (session.runtimeConfig.translationConfig) {
            return
          }

          this.transition({ type: 'SKIP_TRANSLATION' })
          await this.finalizeAndDeliver()
          return
        case 'translation-updated':
          this.applyTranslationUpdate(session, event.payload)
          if (this.status === 'post_processing' && session.translatedText) {
            this.transition({ type: 'TRANSLATION_DONE' })
            await this.finalizeAndDeliver()
          }
          return
        default:
          return assertNever(event)
      }
    } catch (error) {
      await this.fail(error)
    }
  }

  private applyTranslationUpdate(
    session: PttSessionContext,
    payload: TranslationUpdatedPayload
  ): void {
    if (!session.finalText) {
      return
    }

    session.translatedText = payload.translatedText
  }

  private async finalizeAndDeliver(): Promise<void> {
    const session = this.requireActiveSession()
    const text = session.translatedText ?? session.finalText

    if (!text) {
      throw new Error('PTT session finished without final text')
    }

    await this.dependencies.outputDispatcher.deliver({
      text,
      method: session.runtimeConfig.outputConfig.method
    })

    this.transition({ type: 'DELIVERY_SUCCEEDED' })

    const deliveredAt = this.now()
    this.lastResult = {
      text,
      deliveredAt,
      deliveryMethod: session.runtimeConfig.outputConfig.method
    }
    this.error = undefined

    await this.dependencies.transcriptRepository.save({
      id: session.sessionId,
      mode: 'ptt',
      title: text.slice(0, 48) || 'PTT Transcript',
      startedAt: session.startedAt,
      endedAt: deliveredAt,
      language: String(session.runtimeConfig.engineConfig.language),
      plainText: session.finalText ?? text,
      blocks: [
        {
          id: `${session.sessionId}-block-1`,
          source: 'microphone',
          text: session.finalText ?? text,
          ...(session.translatedText ? { translatedText: session.translatedText } : {}),
          startedAt: session.startedAt,
          endedAt: deliveredAt
        }
      ],
      metadata: {
        engineProfileId: session.runtimeConfig.engineProfile.id,
        includeMicrophone: true,
        translationEnabled: Boolean(session.runtimeConfig.translationConfig)
      },
      ...(session.runtimeConfig.translationConfig
        ? {
            targetLanguage: String(session.runtimeConfig.translationConfig.targetLanguage),
            ...(session.translatedText ? { translatedPlainText: session.translatedText } : {})
          }
        : {})
    })

    session.completion.settle()
    this.resetAfterTerminalState()
  }

  private async fail(errorLike: unknown): Promise<void> {
    const error = normalizeErrorPayload(errorLike)
    const session = this.activeSession

    if (this.status !== 'error' && this.status !== 'idle') {
      this.transition({ type: 'FAILED', error })
    }

    this.error = error

    try {
      await session?.engine.abortSession()
    } catch {
      // best effort cleanup
    }

    try {
      await this.dependencies.captureWindowService.abortCapture(session?.sessionId)
    } catch {
      // best effort cleanup
    }

    session?.completion.settle()
    this.resetAfterTerminalState(false)
  }

  private resetAfterTerminalState(clearError = true): void {
    if (this.status === 'completed' || this.status === 'cancelled' || this.status === 'error') {
      this.transition({ type: 'RESET' })
    }

    this.cleanupActiveSession()

    if (clearError) {
      this.error = undefined
    }

    this.emitSnapshot()
  }

  private cleanupActiveSession(): void {
    this.activeEngineUnsubscribe?.()
    this.activeEngineUnsubscribe = null
    this.activeSession = null
  }

  private transition(event: Parameters<typeof transitionPttStatus>[1]): void {
    const result = transitionPttStatus(this.status, event)
    this.status = result.to
    this.emitSnapshot()
  }

  private emitSnapshot(): void {
    const snapshot = this.getSnapshot()

    for (const listener of this.listeners) {
      listener(snapshot)
    }
  }

  private requireActiveSession(): PttSessionContext {
    if (!this.activeSession) {
      throw new Error('No active PTT session')
    }

    return this.activeSession
  }
}

function normalizeErrorPayload(errorLike: unknown): AppErrorPayload {
  if (isAppErrorPayload(errorLike)) {
    return errorLike
  }

  if (errorLike instanceof Error) {
    const payload = (errorLike as Error & { payload?: AppErrorPayload }).payload

    if (payload && isAppErrorPayload(payload)) {
      return payload
    }

    return {
      code: 'E_ENGINE_PROTOCOL',
      message: errorLike.message,
      retryable: true
    }
  }

  return {
    code: 'E_ENGINE_PROTOCOL',
    message: 'Unknown PTT error',
    retryable: true
  }
}

function isAppErrorPayload(value: unknown): value is AppErrorPayload {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Partial<AppErrorPayload>
  return (
    typeof candidate.code === 'string' &&
    typeof candidate.message === 'string' &&
    typeof candidate.retryable === 'boolean'
  )
}

function createCompletionSignal(): { promise: Promise<void>; settle: () => void } {
  let settled = false
  let resolvePromise!: () => void
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve
  })

  return {
    promise,
    settle: () => {
      if (settled) {
        return
      }

      settled = true
      resolvePromise()
    }
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled recognition event: ${String(value)}`)
}
