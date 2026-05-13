import type {
  AudioChunk,
  AppErrorPayload,
  DiagnosticEvent,
  MeetingStatus,
  ResolvedRuntimeConfig,
  RuntimeNotification,
  StartMeetingCommand,
  TranscriptAudioMetadata,
  TranscriptState
} from '../../shared/api-types'
import type { RecognitionEngine, RecognitionEvent } from '../../core/contracts/engine'
import { transitionMeetingStatus } from '../../core/session/session-machine'
import { transcriptReducer, INITIAL_TRANSCRIPT_STATE } from '../../core/transcript/transcript-reducer'
import { selectPlainText, selectTranslatedPlainText } from '../../core/transcript/transcript-selectors'
import type { TranscriptEvent } from '../../core/transcript/transcript-types'
import type { CaptureWindowService } from '../platform/capture-window-service'
import type { SettingsProvider, TranscriptRepositoryLike } from './ptt-coordinator'
import type { MeetingAudioRecorderLike } from './meeting-audio-storage'
import type { TranslationPipeline } from './translation-pipeline'

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
  translationPipeline?: Pick<TranslationPipeline, 'translateBlock'>
  audioRecorderFactory?: (input: { sessionId: string; chunkMs: number }) => MeetingAudioRecorderLike
  deletePersistedAudio?: (relativePath: string) => Promise<void>
  diagnostics?: {
    record(event: DiagnosticEvent): void
  }
  now?: () => number
  createSessionId?: () => string
  recoveryTimeoutMs?: number
}

type MeetingSessionContext = {
  sessionId: string
  startedAt: number
  runtimeConfig: ResolvedRuntimeConfig
  includeMicrophone: boolean
  engine: RecognitionEngine
  transcript: TranscriptState
  pendingTranslations: Set<Promise<void>>
  audioRecorder: MeetingAudioRecorderLike | undefined
  completion: {
    promise: Promise<void>
    settle: () => void
  }
}

export class MeetingCoordinator {
  private readonly now: () => number
  private readonly createSessionId: () => string
  private readonly recoveryTimeoutMs: number
  private activeSession: MeetingSessionContext | null = null
  private activeEngineUnsubscribe: (() => void) | null = null
  private status: MeetingStatus = 'idle'
  private error: AppErrorPayload | undefined
  private readonly listeners = new Set<(snapshot: MeetingRuntimeSnapshot | null) => void>()
  private readonly notificationListeners = new Set<(notification: RuntimeNotification) => void>()
  private terminalSnapshot: MeetingRuntimeSnapshot | null = null
  private recoveryPromise: Promise<void> | null = null
  private recoveryReadySignal: { promise: Promise<void>; settle: () => void } | null = null

  constructor(private readonly dependencies: MeetingCoordinatorDependencies) {
    this.now = dependencies.now ?? Date.now
    this.createSessionId = dependencies.createSessionId ?? (() => `meeting-${this.now()}`)
    this.recoveryTimeoutMs = dependencies.recoveryTimeoutMs ?? 5_000
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
      pendingTranslations: new Set(),
      audioRecorder: this.dependencies.audioRecorderFactory?.({
        sessionId,
        chunkMs: runtimeConfig.captureConfig.chunkMs
      }),
      completion: createCompletionSignal()
    }
    this.dependencies.diagnostics?.record({
      type: 'session-started',
      timestamp: startedAt,
      sessionId,
      mode: 'meeting'
    })
    this.attachEngine(engine)

    try {
      await this.startSessionRuntime(this.activeSession, settings.input.microphoneDeviceId)
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
          if (this.status === 'recovering') {
            this.recoveryReadySignal?.settle()
            return
          }
          if (this.status === 'preparing') {
            this.transition({ type: 'SESSION_READY' })
          }
          return
        case 'draft-updated':
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

          if (
            session.runtimeConfig.translationConfig &&
            !session.runtimeConfig.engineProfile.capabilities.translation
          ) {
            this.startTranslationTask(session, event.payload.block)
          }

          return
        case 'translation-updated':
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
          if (this.status === 'streaming' && event.payload.recoverable) {
            this.transition({
              type: 'ENGINE_WARNING',
              recoverable: event.payload.recoverable
            })
            this.notify({
              level: 'warning',
              message: 'Attempting to recover the live session...'
            })
            await this.recoverSession(session)
            return
          }

          if (this.status === 'streaming') {
            this.transition({
              type: 'ENGINE_WARNING',
              recoverable: event.payload.recoverable
            })
            return
          }

          this.emitSnapshot()
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
        session.audioRecorder?.appendChunk(event.chunk)
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
    await Promise.allSettled([...session.pendingTranslations])
    const endedAt = this.now()
    const plainText = selectPlainText(session.transcript)
    const translatedPlainText = selectTranslatedPlainText(session.transcript)
    const audioMetadata = await this.finalizeSessionAudio(session, 'complete')

    try {
      await this.dependencies.transcriptRepository.save(
        buildSavedTranscript(session, endedAt, plainText, translatedPlainText, audioMetadata)
      )
    } catch (error) {
      if (audioMetadata) {
        await this.cleanupPersistedAudio(audioMetadata)
      }
      throw normalizeStorageErrorPayload(error)
    }

    this.dependencies.diagnostics?.record({
      type: 'session-persisted',
      timestamp: endedAt,
      sessionId: session.sessionId,
      blockCount: session.transcript.committedBlocks.length
    })

    this.notify({
      level: 'info',
      message: 'Live session saved to history.'
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

    if (session && this.status === 'stopped_unexpectedly') {
      await this.persistInterruptedSession(session)
    } else {
      await session?.audioRecorder?.discard()
      if (session) {
        session.audioRecorder = undefined
      }
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
    this.recoveryPromise = null
    this.recoveryReadySignal = null
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

  private attachEngine(engine: RecognitionEngine): void {
    this.activeEngineUnsubscribe?.()
    this.activeEngineUnsubscribe = engine.onEvent((event) => {
      void this.handleEngineEvent(event)
    })
  }

  private async startSessionRuntime(
    session: MeetingSessionContext | null,
    microphoneDeviceId: string,
    restartCapture = true
  ): Promise<void> {
    if (!session) {
      throw new Error('No active meeting session')
    }

    const sources = getMeetingSources(session.includeMicrophone)
    await session.engine.warmup({
      mode: 'meeting',
      language: String(session.runtimeConfig.engineConfig.language)
    })
    await session.engine.startSession({
      sessionId: session.sessionId,
      mode: 'meeting',
      sources,
      language: String(session.runtimeConfig.engineConfig.language),
      translation: {
        enabled:
          Boolean(session.runtimeConfig.translationConfig) &&
          session.runtimeConfig.engineProfile.capabilities.translation,
        ...(session.runtimeConfig.translationConfig
          ? {
              targetLanguage: String(session.runtimeConfig.translationConfig.targetLanguage)
            }
          : {})
      }
    })

    if (restartCapture) {
      await this.dependencies.captureWindowService.startCapture({
        requestId: session.sessionId,
        sources,
        ...(session.includeMicrophone ? { microphoneDeviceId } : {}),
        sampleRate: session.runtimeConfig.captureConfig.sampleRate,
        chunkMs: session.runtimeConfig.captureConfig.chunkMs
      })
    }
  }

  private async recoverSession(session: MeetingSessionContext): Promise<void> {
    if (this.recoveryPromise) {
      await this.recoveryPromise
      return
    }

    const recoveryReadySignal = createCompletionSignal()
    this.recoveryReadySignal = recoveryReadySignal
    const recoveryPromise = this.performRecovery(session, recoveryReadySignal).finally(() => {
      if (this.recoveryPromise === recoveryPromise) {
        this.recoveryPromise = null
      }
      if (this.recoveryReadySignal === recoveryReadySignal) {
        this.recoveryReadySignal = null
      }
    })
    this.recoveryPromise = recoveryPromise
    await recoveryPromise
  }

  private async performRecovery(
    session: MeetingSessionContext,
    recoveryReadySignal: { promise: Promise<void>; settle: () => void }
  ): Promise<void> {
    try {
      try {
        await session.engine.abortSession()
      } catch {
        // best effort cleanup before replacement
      }

      const settings = this.dependencies.settingsProvider.getSettings()
      const nextEngine = this.dependencies.engineFactory(session.runtimeConfig)
      session.engine = nextEngine
      this.attachEngine(nextEngine)

      await this.startSessionRuntime(session, settings.input.microphoneDeviceId, false)
      await waitForRecoveryReady(
        recoveryReadySignal.promise,
        this.recoveryTimeoutMs,
        'Meeting recovery timed out before the engine became ready'
      )

      if (this.activeSession?.sessionId !== session.sessionId || this.status !== 'recovering') {
        return
      }

      this.error = undefined
      this.transition({ type: 'RECOVERY_SUCCEEDED' })
      this.notify({
        level: 'info',
        message: 'Live session recovered.'
      })
    } catch (error) {
      if (this.activeSession?.sessionId !== session.sessionId) {
        return
      }

      await this.fail(error)
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

  private startTranslationTask(
    session: MeetingSessionContext,
    block: TranscriptState['committedBlocks'][number]
  ): void {
    const task = this.translateCommittedBlock(session, block)
    session.pendingTranslations.add(task)
    void task.finally(() => {
      session.pendingTranslations.delete(task)
    })
  }

  private async translateCommittedBlock(
    session: MeetingSessionContext,
    block: TranscriptState['committedBlocks'][number]
  ): Promise<void> {
    if (!session.runtimeConfig.translationConfig || !this.dependencies.translationPipeline) {
      this.notify({
        level: 'warning',
        message: 'Translation is enabled but no translation pipeline is configured. Continuing without translated text.'
      })
      return
    }

    try {
      const translation = await this.dependencies.translationPipeline.translateBlock({
        runtimeConfig: session.runtimeConfig,
        block
      })

      if (this.activeSession?.sessionId !== session.sessionId) {
        return
      }

      session.transcript = reduceTranscript(session.transcript, {
        type: 'translation-updated',
        payload: translation
      })
      this.emitSnapshot()
    } catch (errorLike) {
      if (this.activeSession?.sessionId !== session.sessionId) {
        return
      }

      this.dependencies.diagnostics?.record({
        type: 'translation-failed',
        timestamp: this.now(),
        sessionId: session.sessionId,
        reason: errorLike instanceof Error ? errorLike.message : 'Unknown translation failure'
      })
      this.notify({
        level: 'warning',
        message: 'Translation failed for one transcript block. Continuing with the original transcript.'
      })
    }
  }

  private async persistInterruptedSession(session: MeetingSessionContext): Promise<void> {
    await Promise.allSettled([...session.pendingTranslations])
    const endedAt = this.now()
    const plainText = selectPlainText(session.transcript)
    const translatedPlainText = selectTranslatedPlainText(session.transcript)
    const audioMetadata = await this.finalizeSessionAudio(session, 'partial')
    const hasTranscriptContent =
      plainText.trim().length > 0 || session.transcript.committedBlocks.length > 0

    if (!hasTranscriptContent && !audioMetadata) {
      return
    }

    try {
      await this.dependencies.transcriptRepository.save(
        buildSavedTranscript(session, endedAt, plainText, translatedPlainText, audioMetadata)
      )
      this.dependencies.diagnostics?.record({
        type: 'session-persisted',
        timestamp: endedAt,
        sessionId: session.sessionId,
        blockCount: session.transcript.committedBlocks.length
      })
    } catch (error) {
      if (audioMetadata) {
        await this.cleanupPersistedAudio(audioMetadata)
      }

      this.notify({
        level: 'warning',
        message: error instanceof Error
          ? `Live session ended unexpectedly and could not be saved to history: ${error.message}`
          : 'Live session ended unexpectedly and could not be saved to history.'
      })
    }
  }

  private async finalizeSessionAudio(
    session: MeetingSessionContext,
    status: TranscriptAudioMetadata['status']
  ): Promise<TranscriptAudioMetadata | null> {
    if (!session.audioRecorder) {
      return null
    }

    const recorder = session.audioRecorder
    session.audioRecorder = undefined

    try {
      const audioMetadata = await recorder.finalize(status)

      if (audioMetadata) {
        this.dependencies.diagnostics?.record({
          type: 'audio-persisted',
          timestamp: this.now(),
          sessionId: session.sessionId,
          relativePath: audioMetadata.relativePath,
          byteLength: audioMetadata.byteLength,
          partial: status === 'partial'
        })
      }

      return audioMetadata
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown audio persistence failure'
      this.dependencies.diagnostics?.record({
        type: 'audio-persist-failed',
        timestamp: this.now(),
        sessionId: session.sessionId,
        reason: message
      })
      this.notify({
        level: 'warning',
        message: 'Meeting audio could not be stored.'
      })
      return null
    }
  }

  private async cleanupPersistedAudio(audioMetadata: TranscriptAudioMetadata): Promise<void> {
    if (!this.dependencies.deletePersistedAudio) {
      return
    }

    try {
      await this.dependencies.deletePersistedAudio(audioMetadata.relativePath)
    } catch {
      // best effort cleanup of orphaned audio
    }
  }
}

function reduceTranscript(state: TranscriptState, event: TranscriptEvent): TranscriptState {
  return transcriptReducer(state, event)
}

function buildSavedTranscript(
  session: MeetingSessionContext,
  endedAt: number,
  plainText: string,
  translatedPlainText: string | undefined,
  audioMetadata: TranscriptAudioMetadata | null
) {
  return {
    id: session.sessionId,
    mode: 'meeting' as const,
    title: `Live Session ${new Date(session.startedAt).toISOString()}`,
    startedAt: session.startedAt,
    endedAt,
    language: String(session.runtimeConfig.engineConfig.language),
    plainText,
    blocks: session.transcript.committedBlocks.map((block) => ({ ...block })),
    metadata: {
      engineProfileId: session.runtimeConfig.engineProfile.id,
      includeMicrophone: session.includeMicrophone,
      translationEnabled: Boolean(session.runtimeConfig.translationConfig),
      ...(audioMetadata ? { audio: { ...audioMetadata } } : {})
    },
    ...(session.runtimeConfig.translationConfig
      ? {
          targetLanguage: String(session.runtimeConfig.translationConfig.targetLanguage),
          ...(translatedPlainText ? { translatedPlainText } : {})
        }
      : {})
  }
}

function applyMeetingOverrides(
  runtimeConfig: ResolvedRuntimeConfig,
  input: StartMeetingCommand
): ResolvedRuntimeConfig {
  const translationEnabled = input.translationEnabled ?? Boolean(runtimeConfig.translationConfig)
  const baseTranslationConfig = runtimeConfig.translationConfig

  if (!translationEnabled || !baseTranslationConfig) {
    return {
      engineProfile: runtimeConfig.engineProfile,
      engineConfig: { ...runtimeConfig.engineConfig },
      captureConfig: { ...runtimeConfig.captureConfig },
      outputConfig: { ...runtimeConfig.outputConfig }
    }
  }

  return {
    ...runtimeConfig,
    engineConfig: { ...runtimeConfig.engineConfig },
    captureConfig: { ...runtimeConfig.captureConfig },
    outputConfig: { ...runtimeConfig.outputConfig },
    translationConfig: {
      ...baseTranslationConfig,
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

function getMeetingSources(includeMicrophone: boolean): Array<'system' | 'microphone'> {
  return includeMicrophone ? ['system', 'microphone'] : ['system']
}

async function waitForRecoveryReady(
  promise: Promise<void>,
  timeoutMs: number,
  message: string
): Promise<void> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined

  try {
    await Promise.race([
      promise,
      new Promise<void>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new Error(message))
        }, timeoutMs)
      })
    ])
  } finally {
    if (timeoutHandle !== undefined) {
      clearTimeout(timeoutHandle)
    }
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
