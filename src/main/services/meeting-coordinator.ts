import type {
  AppErrorPayload,
  DiagnosticEvent,
  MeetingStatus,
  ResolvedRuntimeConfig,
  RuntimeNotification,
  StartMeetingCommand,
  TranscriptState
} from '../../shared/api-types'
import type { RecognitionEngine, RecognitionEvent } from '../../core/contracts/engine'
import { transitionMeetingStatus } from '../../core/session/session-machine'
import { transcriptReducer, INITIAL_TRANSCRIPT_STATE } from '../../core/transcript/transcript-reducer'
import type { TranscriptEvent } from '../../core/transcript/transcript-types'
import type { CaptureWindowService } from '../platform/capture-window-service'
import type { SettingsProvider, TranscriptRepositoryLike } from './ptt-coordinator'

export type MeetingRuntimeSnapshot = {
  sessionId: string
  status: MeetingStatus
  startedAt: number | null
  durationSec: number
  transcript: TranscriptState
  engineProfileId: string
  translationEnabled: boolean
  error?: AppErrorPayload
}

export type MeetingCoordinatorDependencies = {
  settingsProvider: SettingsProvider
  engineFactory: (config: ResolvedRuntimeConfig) => RecognitionEngine
  captureWindowService: CaptureWindowService
  transcriptRepository: TranscriptRepositoryLike
  diagnostics?: {
    record(event: DiagnosticEvent): void
  }
  now?: () => number
  createSessionId?: () => string
}

type MeetingSessionContext = {
  sessionId: string
  startedAt: number
  runtimeConfig: ResolvedRuntimeConfig
  includeMicrophone: boolean
  engine: RecognitionEngine
  transcript: TranscriptState
  completion: {
    promise: Promise<void>
    settle: () => void
  }
}

export class MeetingCoordinator {
  private readonly now: () => number
  private readonly createSessionId: () => string
  private activeSession: MeetingSessionContext | null = null
  private activeEngineUnsubscribe: (() => void) | null = null
  private status: MeetingStatus = 'idle'
  private error: AppErrorPayload | undefined
  private readonly listeners = new Set<(snapshot: MeetingRuntimeSnapshot | null) => void>()
  private readonly notificationListeners = new Set<(notification: RuntimeNotification) => void>()
  private terminalSnapshot: MeetingRuntimeSnapshot | null = null

  constructor(private readonly dependencies: MeetingCoordinatorDependencies) {
    this.now = dependencies.now ?? Date.now
    this.createSessionId = dependencies.createSessionId ?? (() => `meeting-${this.now()}`)
    this.dependencies.captureWindowService.onEvent((event) => {
      void this.handleCaptureEvent(event)
    })
  }

  getSnapshot(): MeetingRuntimeSnapshot | null {
    if (!this.activeSession) {
      return this.terminalSnapshot ? cloneMeetingSnapshot(this.terminalSnapshot) : null
    }

    return {
      sessionId: this.activeSession.sessionId,
      status: this.status,
      startedAt: this.activeSession.startedAt,
      durationSec: Math.max(0, Math.floor((this.now() - this.activeSession.startedAt) / 1000)),
      transcript: cloneTranscriptState(this.activeSession.transcript),
      engineProfileId: this.activeSession.runtimeConfig.engineProfile.id,
      translationEnabled: Boolean(this.activeSession.runtimeConfig.translationConfig),
      ...(this.error ? { error: { ...this.error } } : {})
    }
  }

  onSnapshot(listener: (snapshot: MeetingRuntimeSnapshot | null) => void): () => void {
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

  async start(input: StartMeetingCommand = {}): Promise<void> {
    if (this.activeSession || this.status !== 'idle') {
      throw new Error('Meeting session is already active')
    }

    this.transition({ type: 'START_REQUESTED' })
    this.terminalSnapshot = null

    const settings = this.dependencies.settingsProvider.getSettings()
    const runtimeConfig = applyMeetingOverrides(
      this.dependencies.settingsProvider.resolveRuntimeConfig('meeting'),
      input
    )
    const includeMicrophone = input.includeMicrophone ?? settings.input.includeMicrophoneInMeeting
    const sources = includeMicrophone ? (['system', 'microphone'] as const) : (['system'] as const)
    const engine = this.dependencies.engineFactory(runtimeConfig)
    const sessionId = this.createSessionId()
    const startedAt = this.now()

    this.activeSession = {
      sessionId,
      startedAt,
      runtimeConfig,
      includeMicrophone,
      engine,
      transcript: INITIAL_TRANSCRIPT_STATE,
      completion: createCompletionSignal()
    }
    this.dependencies.diagnostics?.record({
      type: 'session-started',
      timestamp: startedAt,
      sessionId,
      mode: 'meeting'
    })

    this.activeEngineUnsubscribe = engine.onEvent((event) => {
      void this.handleEngineEvent(event)
    })

    try {
      await engine.warmup({
        mode: 'meeting',
        language: String(runtimeConfig.engineConfig.language)
      })
      await engine.startSession({
        sessionId,
        mode: 'meeting',
        sources: [...sources],
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
        sources: [...sources],
        ...(includeMicrophone ? { microphoneDeviceId: settings.input.microphoneDeviceId } : {}),
        sampleRate: runtimeConfig.captureConfig.sampleRate,
        chunkMs: runtimeConfig.captureConfig.chunkMs
      })
    } catch (error) {
      await this.fail(error)
      throw error
    }
  }

  async stop(): Promise<void> {
    const session = this.requireActiveSession()

    if (this.status !== 'streaming') {
      throw new Error(`Cannot stop meeting session from status "${this.status}"`)
    }

    this.transition({ type: 'STOP_REQUESTED' })
    await this.dependencies.captureWindowService.stopCapture(session.sessionId)
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
          this.dependencies.diagnostics?.record({
            type: 'engine-ready',
            timestamp: this.now(),
            sessionId: session.sessionId,
            profileId: session.runtimeConfig.engineProfile.id
          })
          this.recoverIfNeeded()
          if (this.status === 'preparing') {
            this.transition({ type: 'SESSION_READY' })
          }
          return
        case 'draft-updated':
          this.recoverIfNeeded()
          session.transcript = reduceTranscript(session.transcript, {
            type: 'draft-updated',
            payload: event.payload
          })
          this.dependencies.diagnostics?.record({
            type: 'draft-received',
            timestamp: this.now(),
            sessionId: session.sessionId,
            source: event.payload.source,
            chars: `${event.payload.stableText}${event.payload.previewText}`.trim().length
          })
          if (this.status === 'streaming') {
            this.transition({ type: 'DRAFT_UPDATED' })
          } else {
            this.emitSnapshot()
          }
          return
        case 'block-committed':
          this.recoverIfNeeded()
          session.transcript = reduceTranscript(session.transcript, {
            type: 'block-committed',
            payload: event.payload
          })
          this.dependencies.diagnostics?.record({
            type: 'block-committed',
            timestamp: this.now(),
            sessionId: session.sessionId,
            blockId: event.payload.block.id,
            chars: event.payload.block.text.length
          })
          if (this.status === 'streaming') {
            this.transition({ type: 'BLOCK_COMMITTED' })
          } else {
            this.emitSnapshot()
          }
          return
        case 'translation-updated':
          this.recoverIfNeeded()
          session.transcript = reduceTranscript(session.transcript, {
            type: 'translation-updated',
            payload: event.payload
          })
          this.emitSnapshot()
          return
        case 'session-ended':
          if (this.status === 'finishing') {
            this.transition({ type: 'SESSION_ENDED' })
            await this.persistAndComplete()
          }
          return
        case 'warning':
          this.notify({
            level: event.payload.recoverable ? 'warning' : 'error',
            message: event.payload.message
          })
          if (this.status === 'streaming') {
            this.transition({
              type: 'ENGINE_WARNING',
              recoverable: event.payload.recoverable
            })
          } else {
            this.emitSnapshot()
          }
          return
        case 'error':
          await this.fail(event.payload)
          return
        default:
          return assertNever(event)
      }
    } catch (error) {
      await this.fail(error)
    }
  }

  private async handleCaptureEvent(
    event: Parameters<CaptureWindowService['onEvent']>[0] extends (payload: infer Event) => void ? Event : never
  ): Promise<void> {
    const session = this.activeSession

    if (!session || event.requestId !== session.sessionId) {
      return
    }

    switch (event.type) {
      case 'audio-chunk':
        session.engine.pushAudio(event.chunk)
        return
      case 'capture-error':
        await this.fail(event.error)
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
        return
      default:
        return assertNever(event)
    }
  }

  private async persistAndComplete(): Promise<void> {
    const session = this.requireActiveSession()
    const endedAt = this.now()
    const plainText = session.transcript.committedBlocks.map((block) => block.text).join('\n')
    const translatedPlainText = session.transcript.committedBlocks
      .map((block) => block.translatedText)
      .filter((value): value is string => Boolean(value))
      .join('\n')

    try {
      await this.dependencies.transcriptRepository.save({
        id: session.sessionId,
        mode: 'meeting',
        title: `Live Session ${new Date(session.startedAt).toISOString()}`,
        startedAt: session.startedAt,
        endedAt,
        language: String(session.runtimeConfig.engineConfig.language),
        plainText,
        blocks: session.transcript.committedBlocks.map((block) => ({ ...block })),
        metadata: {
          engineProfileId: session.runtimeConfig.engineProfile.id,
          includeMicrophone: session.includeMicrophone,
          translationEnabled: Boolean(session.runtimeConfig.translationConfig)
        },
        ...(session.runtimeConfig.translationConfig
          ? {
              targetLanguage: String(session.runtimeConfig.translationConfig.targetLanguage),
              ...(translatedPlainText ? { translatedPlainText } : {})
            }
          : {})
      })
    } catch (error) {
      throw normalizeStorageErrorPayload(error)
    }

    this.dependencies.diagnostics?.record({
      type: 'session-persisted',
      timestamp: endedAt,
      sessionId: session.sessionId,
      blockCount: session.transcript.committedBlocks.length
    })

    this.transition({ type: 'PERSIST_SUCCEEDED' })
    session.completion.settle()
    this.resetAfterTerminalState()
  }

  private async fail(errorLike: unknown): Promise<void> {
    const error = normalizeErrorPayload(errorLike)
    const session = this.activeSession

    if (
      this.status !== 'idle' &&
      this.status !== 'completed' &&
      this.status !== 'stopped_unexpectedly' &&
      this.status !== 'error'
    ) {
      this.transition({ type: 'FAILED', error })
    }

    this.error = error
    if (session) {
      this.dependencies.diagnostics?.record({
        type: 'session-failed',
        timestamp: this.now(),
        sessionId: session.sessionId,
        errorCode: error.code
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

    this.terminalSnapshot = session ? this.createSnapshotForSession(session) : this.terminalSnapshot
    session?.completion.settle()
    this.resetAfterTerminalState(false)
  }

  private resetAfterTerminalState(clearError = true): void {
    if (this.status === 'completed' || this.status === 'stopped_unexpectedly' || this.status === 'error') {
      this.transition({ type: 'RESET' })
    }

    this.cleanupActiveSession()

    if (clearError) {
      this.error = undefined
      this.terminalSnapshot = null
    }

    this.emitSnapshot()
  }

  private cleanupActiveSession(): void {
    this.activeEngineUnsubscribe?.()
    this.activeEngineUnsubscribe = null
    this.activeSession = null
  }

  private transition(event: Parameters<typeof transitionMeetingStatus>[1]): void {
    const result = transitionMeetingStatus(this.status, event)
    this.status = result.to
    this.emitSnapshot()
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

  private recoverIfNeeded(): void {
    if (this.status === 'recovering') {
      this.transition({ type: 'RECOVERY_SUCCEEDED' })
    }
  }

  private createSnapshotForSession(session: MeetingSessionContext): MeetingRuntimeSnapshot {
    return {
      sessionId: session.sessionId,
      status: this.status,
      startedAt: session.startedAt,
      durationSec: Math.max(0, Math.floor((this.now() - session.startedAt) / 1000)),
      transcript: cloneTranscriptState(session.transcript),
      engineProfileId: session.runtimeConfig.engineProfile.id,
      translationEnabled: Boolean(session.runtimeConfig.translationConfig),
      ...(this.error ? { error: { ...this.error } } : {})
    }
  }

  private requireActiveSession(): MeetingSessionContext {
    if (!this.activeSession) {
      throw new Error('No active meeting session')
    }

    return this.activeSession
  }
}

function reduceTranscript(state: TranscriptState, event: TranscriptEvent): TranscriptState {
  return transcriptReducer(state, event)
}

function applyMeetingOverrides(
  runtimeConfig: ResolvedRuntimeConfig,
  input: StartMeetingCommand
): ResolvedRuntimeConfig {
  const translationEnabled = input.translationEnabled ?? Boolean(runtimeConfig.translationConfig)

  if (!translationEnabled) {
    return {
      engineProfile: runtimeConfig.engineProfile,
      engineConfig: { ...runtimeConfig.engineConfig },
      captureConfig: { ...runtimeConfig.captureConfig },
      outputConfig: { ...runtimeConfig.outputConfig }
    }
  }

  const baseTranslationConfig = runtimeConfig.translationConfig

  return {
    ...runtimeConfig,
    engineConfig: { ...runtimeConfig.engineConfig },
    captureConfig: { ...runtimeConfig.captureConfig },
    outputConfig: { ...runtimeConfig.outputConfig },
    translationConfig: {
      ...(baseTranslationConfig ? { ...baseTranslationConfig } : {}),
      ...(baseTranslationConfig
        ? {}
        : {
            sourceLanguage: String(runtimeConfig.engineConfig.language)
          }),
      ...(input.targetLanguage ? { targetLanguage: input.targetLanguage } : {})
    }
  }
}

function cloneTranscriptState(transcript: TranscriptState): TranscriptState {
  return {
    committedBlocks: transcript.committedBlocks.map((block) => ({
      ...block,
      ...(block.words ? { words: [...block.words] } : {})
    })),
    activeDrafts: Object.fromEntries(
      Object.entries(transcript.activeDrafts).map(([source, draft]) => [
        source,
        draft
          ? {
              ...draft,
              ...(draft.words ? { words: [...draft.words] } : {})
            }
          : draft
      ])
    ),
    revision: transcript.revision
  }
}

function cloneMeetingSnapshot(snapshot: MeetingRuntimeSnapshot): MeetingRuntimeSnapshot {
  return {
    ...snapshot,
    transcript: cloneTranscriptState(snapshot.transcript),
    ...(snapshot.error ? { error: { ...snapshot.error } } : {})
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
    message: 'Unknown meeting error',
    retryable: true
  }
}

function normalizeStorageErrorPayload(errorLike: unknown): AppErrorPayload {
  return {
    code: 'E_STORAGE_WRITE',
    message: errorLike instanceof Error ? errorLike.message : 'Failed to persist meeting transcript',
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
  throw new Error(`Unhandled meeting recognition event: ${String(value)}`)
}
