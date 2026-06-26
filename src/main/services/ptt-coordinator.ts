import type {
  AppErrorPayload,
  AppSettings,
  DiagnosticEvent,
  OutputMethod,
  ResolvedRuntimeConfig,
  RuntimeNotification,
  SavedTranscript
} from '../../shared/api-types'
import type { SessionMode } from '../../shared/primitive-types'
import type {
  RecognitionEngine,
  RecognitionEvent,
  TranslationUpdatedPayload
} from '../../core/contracts/engine'
import { buildPttSavedTranscript } from '../../core/transcript/transcript-provenance'
import { SessionDispatchLoop } from '../../core/session/session-dispatch'
import type { PttTransitionEffect } from '../../core/session/session-machine'
import { transitionPttStatus } from '../../core/session/session-machine'
import type { PttSessionEvent } from '../../core/session/session-types'
import type { CaptureWindowService } from '../platform/capture-window-service'
import type { TranslationPipeline } from './translation-pipeline'

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
  deliver(input: {
    text: string
    method: OutputMethod
  }): Promise<{ requestedMethod: OutputMethod; methodUsed: OutputMethod; fallbackReason?: string }>
}

export type PttCoordinatorDependencies = {
  settingsProvider: SettingsProvider
  engineFactory: (config: ResolvedRuntimeConfig) => RecognitionEngine
  captureWindowService: CaptureWindowService
  transcriptRepository: TranscriptRepositoryLike
  outputDispatcher: OutputDispatcherLike
  translationPipeline?: Pick<TranslationPipeline, 'translateBlock'>
  diagnostics?: {
    record(event: DiagnosticEvent): void
  }
  completionTimeoutMs?: number
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
  committedBlock: SavedTranscript['blocks'][number] | null
  completion: {
    promise: Promise<void>
    settle: () => void
  }
}

type PttEffectResult =
  | { followUps?: PttSessionEvent | PttSessionEvent[] }
  | { failed: AppErrorPayload }

export class PttCoordinator {
  private readonly completionTimeoutMs: number
  private readonly now: () => number
  private readonly createSessionId: () => string
  private status: PttRuntimeSnapshot['status'] = 'idle'
  private lastResult: PttRuntimeSnapshot['lastResult']
  private error: AppErrorPayload | undefined
  private lastFailedText: string | null = null
  private activeSession: PttSessionContext | null = null
  private activeEngineUnsubscribe: (() => void) | null = null
  private pendingStartupFailure: AppErrorPayload | null = null
  private readonly listeners = new Set<(snapshot: PttRuntimeSnapshot) => void>()
  private readonly notificationListeners = new Set<(notification: RuntimeNotification) => void>()
  private readonly sessionDispatch: SessionDispatchLoop<
    PttRuntimeSnapshot['status'],
    PttSessionEvent,
    PttTransitionEffect
  >

  constructor(private readonly dependencies: PttCoordinatorDependencies) {
    this.completionTimeoutMs = dependencies.completionTimeoutMs ?? 15_000
    this.now = dependencies.now ?? Date.now
    this.createSessionId = dependencies.createSessionId ?? (() => `ptt-${this.now()}`)
    this.sessionDispatch = new SessionDispatchLoop({
      getStatus: () => this.status,
      setStatus: (status) => {
        this.status = status
      },
      transition: transitionPttStatus,
      runEffect: (effect, event) => this.runEffect(effect, event),
      emitSnapshot: () => this.emitSnapshot(),
      createFailedEvent: (error) => ({ type: 'FAILED', error }),
      effectNeedsPostEmit: pttEffectNeedsPostEmit,
      onEffectFailed: ({ effect, failed }) => {
        if (effect === 'prepare-capture-request') {
          this.pendingStartupFailure = failed
        }
      },
      enableReentrantEnqueue: false
    })
    this.dependencies.captureWindowService.onEvent((event) => {
      void this.handleCaptureEvent(event)
    })
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

  onNotification(listener: (notification: RuntimeNotification) => void): () => void {
    this.notificationListeners.add(listener)

    return () => {
      this.notificationListeners.delete(listener)
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

    this.pendingStartupFailure = null
    await this.dispatch({ type: 'PTT_HOTKEY_DOWN' })

    if (this.pendingStartupFailure) {
      const error = this.pendingStartupFailure
      this.pendingStartupFailure = null
      throw Object.assign(new Error(error.message), { payload: error })
    }
  }

  async stop(): Promise<void> {
    if (!this.activeSession) {
      throw new Error('No active PTT session')
    }

    if (this.status !== 'capturing') {
      throw new Error(`Cannot stop PTT session from status "${this.status}"`)
    }

    await this.dispatch({ type: 'PTT_HOTKEY_UP' })
  }

  async copyLatestText(): Promise<void> {
    const text = this.lastResult?.text ?? this.lastFailedText

    if (!text) {
      throw new Error('No recent transcript is available to copy')
    }

    const delivery = await this.dependencies.outputDispatcher.deliver({
      text,
      method: 'clipboard'
    })

    this.lastResult = {
      text,
      deliveredAt: this.now(),
      deliveryMethod: delivery.methodUsed
    }
    this.lastFailedText = null
    this.error = undefined
    this.notify({
      level: 'info',
      message: 'Copied the latest transcript to the clipboard.'
    })
    this.emitSnapshot()
  }

  private dispatch(event: PttSessionEvent): Promise<void> {
    return this.sessionDispatch.dispatch(event)
  }

  private async runEffect(effect: PttTransitionEffect, event: PttSessionEvent): Promise<PttEffectResult> {
    switch (effect) {
      case 'prepare-capture-request':
        return this.runPrepareCaptureRequest()
      case 'begin-audio-capture':
        return {}
      case 'stop-capture-and-flush':
        return this.runStopCaptureAndFlush()
      case 'discard-transcript':
        return this.runDiscardTranscript()
      case 'finalize-transcript':
        return this.runFinalizeTranscript()
      case 'dispatch-output':
        return this.runDispatchOutput()
      case 'persist-result':
        return this.runPersistResult()
      case 'record-error':
        return this.runRecordError(event)
      case 'clear-runtime':
        return this.runClearRuntime(event)
      default:
        return assertNever(effect)
    }
  }

  private async runPrepareCaptureRequest(): Promise<PttEffectResult> {
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
      committedBlock: null,
      completion: createCompletionSignal()
    }
    this.dependencies.diagnostics?.record({
      type: 'session-started',
      timestamp: startedAt,
      sessionId,
      mode: 'ptt'
    })

    this.activeEngineUnsubscribe = engine.onEvent((engineEvent) => {
      void this.handleEngineEvent(engineEvent)
    })

    try {
      await engine.startSession({
        sessionId,
        mode: 'ptt',
        sources: ['microphone'],
        language: String(runtimeConfig.engineConfig.language),
        translation: {
          enabled: Boolean(runtimeConfig.translationConfig) && runtimeConfig.engineProfile.capabilities.translation,
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
    } catch (errorLike) {
      return { failed: normalizeErrorPayload(errorLike) }
    }

    return { followUps: { type: 'CAPTURE_STARTED' } }
  }

  private async runStopCaptureAndFlush(): Promise<PttEffectResult> {
    const session = this.requireActiveSession()
    session.stopCapturePromise = this.dependencies.captureWindowService.stopCapture(session.sessionId)

    try {
      await session.stopCapturePromise
      await waitForPttCompletion(session.completion.promise, this.completionTimeoutMs)
    } catch (errorLike) {
      return { failed: normalizeErrorPayload(errorLike) }
    }

    return {}
  }

  private async runDiscardTranscript(): Promise<PttEffectResult> {
    const session = this.activeSession

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
    return { followUps: { type: 'RESET', clearError: true } }
  }

  private async runFinalizeTranscript(): Promise<PttEffectResult> {
    const session = this.requireActiveSession()

    if (!session.runtimeConfig.translationConfig) {
      return { followUps: { type: 'SKIP_TRANSLATION' } }
    }

    if (session.runtimeConfig.engineProfile.capabilities.translation) {
      return {}
    }

    if (!session.committedBlock) {
      return { failed: {
        code: 'E_ENGINE_PROTOCOL',
        message: 'PTT session finished without final text',
        retryable: true
      } }
    }

    if (!this.dependencies.translationPipeline) {
      this.notify({
        level: 'warning',
        message: 'Translation is enabled but no translation pipeline is configured. Delivered the original transcript instead.'
      })
      return { followUps: { type: 'SKIP_TRANSLATION' } }
    }

    try {
      const translation = await this.dependencies.translationPipeline.translateBlock({
        runtimeConfig: session.runtimeConfig,
        block: session.committedBlock
      })

      if (this.activeSession?.sessionId !== session.sessionId) {
        return {}
      }

      this.applyTranslationUpdate(session, translation)
      if (session.translatedText) {
        return { followUps: { type: 'TRANSLATION_DONE' } }
      }

      return { followUps: { type: 'SKIP_TRANSLATION' } }
    } catch (errorLike) {
      if (this.activeSession?.sessionId !== session.sessionId) {
        return {}
      }

      this.dependencies.diagnostics?.record({
        type: 'translation-failed',
        timestamp: this.now(),
        sessionId: session.sessionId,
        reason: errorLike instanceof Error ? errorLike.message : 'Unknown translation failure'
      })
      this.notify({
        level: 'warning',
        message: 'Translation failed. Delivered the original transcript instead.'
      })
      return { followUps: { type: 'SKIP_TRANSLATION' } }
    }
  }

  private async runDispatchOutput(): Promise<PttEffectResult> {
    const session = this.requireActiveSession()
    const text = session.translatedText ?? session.finalText

    if (!text) {
      return { failed: {
        code: 'E_ENGINE_PROTOCOL',
        message: 'PTT session finished without final text',
        retryable: true
      } }
    }

    try {
      const delivery = await this.dependencies.outputDispatcher.deliver({
        text,
        method: session.runtimeConfig.outputConfig.method
      })

      const deliveredAt = this.now()
      this.lastResult = {
        text,
        deliveredAt,
        deliveryMethod: delivery.methodUsed
      }
      this.lastFailedText = null
      this.error = undefined

      this.dependencies.diagnostics?.record({
        type: 'output-delivered',
        timestamp: deliveredAt,
        sessionId: session.sessionId,
        requestedMethod: delivery.requestedMethod,
        methodUsed: delivery.methodUsed,
        fallback: delivery.requestedMethod !== delivery.methodUsed
      })

      if (delivery.requestedMethod !== delivery.methodUsed) {
        this.notify({
          level: 'warning',
          message:
            delivery.fallbackReason
              ? `${delivery.fallbackReason} Copied the transcript to the clipboard instead.`
              : 'Preferred output failed. Copied the transcript to the clipboard instead.'
        })
      }

      return { followUps: { type: 'DELIVERY_SUCCEEDED' } }
    } catch (errorLike) {
      const error = normalizeErrorPayload(errorLike)
      return { followUps: { type: 'DELIVERY_FAILED', error } }
    }
  }

  private async runPersistResult(): Promise<PttEffectResult> {
    const session = this.requireActiveSession()
    const text = session.translatedText ?? session.finalText

    if (!text) {
      return { failed: {
        code: 'E_ENGINE_PROTOCOL',
        message: 'PTT session finished without final text',
        retryable: true
      } }
    }

    const deliveredAt = this.now()

    try {
      await this.dependencies.transcriptRepository.save(
        buildPttSavedTranscript({
          sessionId: session.sessionId,
          startedAt: session.startedAt,
          endedAt: deliveredAt,
          runtimeConfig: session.runtimeConfig,
          finalText: session.finalText ?? text,
          translatedText: session.translatedText
        })
      )
    } catch (errorLike) {
      this.error = normalizeStorageErrorPayload(errorLike)
      session.completion.settle()
      return { followUps: { type: 'RESET', clearError: false } }
    }

    this.dependencies.diagnostics?.record({
      type: 'session-persisted',
      timestamp: deliveredAt,
      sessionId: session.sessionId,
      blockCount: 1
    })

    session.completion.settle()
    return { followUps: { type: 'RESET', clearError: true } }
  }

  private async runRecordError(event: PttSessionEvent): Promise<PttEffectResult> {
    const error =
      (event.type === 'FAILED' || event.type === 'DELIVERY_FAILED') && event.error
        ? event.error
        : {
            code: 'E_ENGINE_PROTOCOL',
            message: 'Unknown PTT error',
            retryable: true
          }
    const session = this.activeSession

    this.error = error
    this.lastFailedText =
      error.code === 'E_OUTPUT_DELIVERY' && typeof error.detail?.transcriptText === 'string'
        ? error.detail.transcriptText
        : this.lastFailedText

    if (session) {
      this.dependencies.diagnostics?.record({
        type: 'session-failed',
        timestamp: this.now(),
        sessionId: session.sessionId,
        errorCode: error.code
      })
    }

    if (error.code === 'E_OUTPUT_DELIVERY' && this.lastFailedText) {
      this.notify({
        level: 'error',
        message: 'Transcript delivery failed. Use Copy Latest Text to recover the result.'
      })
    }

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
    return { followUps: { type: 'RESET', clearError: false } }
  }

  private runClearRuntime(event: PttSessionEvent): PttEffectResult {
    this.cleanupActiveSession()

    if (event.type === 'RESET' && event.clearError === false) {
      return {}
    }

    this.error = undefined
    this.lastFailedText = null
    return {}
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
          return
        case 'session-ended':
          if (this.status === 'recognizing' && !session.finalText) {
            this.notify({
              level: 'warning',
              message: 'No speech was captured. Check the microphone level and try again.'
            })
            await this.dispatch({
              type: 'FAILED',
              error: {
                code: 'E_NO_SPEECH_DETECTED',
                message: 'PTT session ended without a transcript.',
                retryable: true
              }
            })
            return
          }

          if (
            this.status === 'post_processing' &&
            session.finalText &&
            session.runtimeConfig.translationConfig &&
            session.runtimeConfig.engineProfile.capabilities.translation
          ) {
            this.dependencies.diagnostics?.record({
              type: 'translation-failed',
              timestamp: this.now(),
              sessionId: session.sessionId,
              reason: 'Translation did not complete before the session ended'
            })
            this.notify({
              level: 'warning',
              message: 'Translation did not complete. Delivered the original transcript instead.'
            })
            await this.dispatch({ type: 'SKIP_TRANSLATION' })
          }
          return
        case 'error':
          await this.dispatch({ type: 'FAILED', error: event.payload })
          return
        case 'block-committed':
          session.finalText = event.payload.block.text
          session.committedBlock = event.payload.block
          this.dependencies.diagnostics?.record({
            type: 'block-committed',
            timestamp: this.now(),
            sessionId: session.sessionId,
            blockId: event.payload.block.id,
            chars: event.payload.block.text.length
          })
          if (this.status === 'recognizing') {
            await this.dispatch({ type: 'BLOCK_COMMITTED' })
          }
          return
        case 'translation-updated':
          this.applyTranslationUpdate(session, event.payload)
          if (this.status === 'post_processing' && session.translatedText) {
            await this.dispatch({ type: 'TRANSLATION_DONE' })
          }
          return
        default:
          return assertNever(event)
      }
    } catch (error) {
      await this.dispatch({ type: 'FAILED', error: normalizeErrorPayload(error) })
    }
  }

  private async handleCaptureEvent(
    event: Parameters<CaptureWindowService['onEvent']>[0] extends (payload: infer Event) => void ? Event : never
  ): Promise<void> {
    const session = this.activeSession

    if (!session || event.requestId !== session.sessionId) {
      return
    }

    try {
      switch (event.type) {
        case 'audio-chunk':
          session.engine.pushAudio(event.chunk)
          return
        case 'capture-error':
          await this.dispatch({ type: 'FAILED', error: event.error })
          return
        case 'capture-started':
          this.dependencies.diagnostics?.record({
            type: 'capture-started',
            timestamp: this.now(),
            sessionId: session.sessionId,
            sources: [...event.sources]
          })
          return
        case 'capture-stopped':
          if (this.status === 'recognizing') {
            await session.engine.stopSession()
          }
          return
        default:
          return assertNever(event)
      }
    } catch (error) {
      await this.dispatch({ type: 'FAILED', error: normalizeErrorPayload(error) })
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

  private cleanupActiveSession(): void {
    this.activeEngineUnsubscribe?.()
    this.activeEngineUnsubscribe = null
    this.activeSession = null
  }

  private emitSnapshot(): void {
    const snapshot = this.getSnapshot()

    for (const listener of this.listeners) {
      listener(snapshot)
    }
  }

  private notify(notification: RuntimeNotification): void {
    for (const listener of this.notificationListeners) {
      listener(notification)
    }
  }

  private requireActiveSession(): PttSessionContext {
    if (!this.activeSession) {
      throw new Error('No active PTT session')
    }

    return this.activeSession
  }
}

function pttEffectNeedsPostEmit(effect: PttTransitionEffect): boolean {
  switch (effect) {
    case 'prepare-capture-request':
    case 'dispatch-output':
    case 'persist-result':
    case 'record-error':
    case 'clear-runtime':
      return true
    default:
      return false
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

  if (errorLike && typeof errorLike === 'object') {
    const candidate = errorLike as Partial<AppErrorPayload>
    if (
      typeof candidate.code === 'string' &&
      typeof candidate.message === 'string' &&
      typeof candidate.retryable === 'boolean'
    ) {
      return candidate as AppErrorPayload
    }
  }

  return {
    code: 'E_ENGINE_PROTOCOL',
    message: 'Unknown PTT error',
    retryable: true
  }
}

function normalizeStorageErrorPayload(errorLike: unknown): AppErrorPayload {
  return {
    code: 'E_STORAGE_WRITE',
    message: errorLike instanceof Error ? errorLike.message : 'Failed to persist PTT transcript',
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

async function waitForPttCompletion(promise: Promise<void>, timeoutMs: number): Promise<void> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined

  try {
    await Promise.race([
      promise,
      new Promise<void>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject({
            code: 'E_ENGINE_TIMEOUT',
            message: 'Timed out waiting for dictation to finish.',
            retryable: true
          } satisfies AppErrorPayload)
        }, timeoutMs)
      })
    ])
  } finally {
    if (timeoutHandle !== undefined) {
      clearTimeout(timeoutHandle)
    }
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled PTT value: ${String(value)}`)
}
