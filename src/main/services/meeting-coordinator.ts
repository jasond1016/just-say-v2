import type {
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
import { SessionDispatchLoop } from '../../core/session/session-dispatch'
import type { MeetingTransitionEffect } from '../../core/session/session-machine'
import { transitionMeetingStatus } from '../../core/session/session-machine'
import type { MeetingSessionEvent } from '../../core/session/session-types'
import { buildMeetingSavedTranscript } from '../../core/transcript/transcript-provenance'
import type { CaptureWindowService } from '../platform/capture-window-service'
import type { SettingsProvider, TranscriptRepositoryLike } from './ptt-coordinator'
import type { MeetingAudioRecorderLike } from './meeting-audio-storage'
import type { TranslationPipeline } from './translation-pipeline'
import { MeetingLiveTranscript } from './meeting-live-transcript'
import {
  normalizeRecognitionError,
  RecognitionSessionBridge,
  type RecognitionCaptureControlEvent
} from './recognition-session-bridge'

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
  audioRecorder: MeetingAudioRecorderLike | undefined
  pendingPersist: PendingPersistContext | null
  completion: {
    promise: Promise<void>
    settle: () => void
  }
}

type PendingPersistContext = {
  endedAt: number
  plainText: string
  translatedPlainText?: string
  audioMetadata: TranscriptAudioMetadata | null
}

type MeetingEffectResult =
  | { followUps?: MeetingSessionEvent | MeetingSessionEvent[] }
  | { failed: AppErrorPayload }

export class MeetingCoordinator {
  private readonly now: () => number
  private readonly createSessionId: () => string
  private readonly recoveryTimeoutMs: number
  private activeSession: MeetingSessionContext | null = null
  private status: MeetingStatus = 'idle'
  private error: AppErrorPayload | undefined
  private pendingStartInput: StartMeetingCommand = {}
  private pendingStartupFailure: AppErrorPayload | null = null
  private readonly listeners = new Set<(snapshot: MeetingRuntimeSnapshot | null) => void>()
  private readonly notificationListeners = new Set<(notification: RuntimeNotification) => void>()
  private terminalSnapshot: MeetingRuntimeSnapshot | null = null
  private readonly recognitionSession: RecognitionSessionBridge
  private readonly liveTranscript: MeetingLiveTranscript
  private readonly sessionDispatch: SessionDispatchLoop<MeetingStatus, MeetingSessionEvent, MeetingTransitionEffect>
  private awaitingStopSessionEnd = false
  private recoveryPromise: Promise<void> | null = null
  private recoveryReadySignal: { promise: Promise<void>; settle: () => void } | null = null

  constructor(private readonly dependencies: MeetingCoordinatorDependencies) {
    this.now = dependencies.now ?? Date.now
    this.createSessionId = dependencies.createSessionId ?? (() => `meeting-${this.now()}`)
    this.recoveryTimeoutMs = dependencies.recoveryTimeoutMs ?? 5_000
    this.recognitionSession = new RecognitionSessionBridge(dependencies.captureWindowService)
    this.liveTranscript = new MeetingLiveTranscript({
      ...(dependencies.translationPipeline
        ? { translationPipeline: dependencies.translationPipeline }
        : {}),
      ...(dependencies.diagnostics ? { diagnostics: dependencies.diagnostics } : {}),
      now: this.now,
      notify: (notification) => this.notify(notification),
      onChanged: () => this.emitSnapshot()
    })
    this.sessionDispatch = new SessionDispatchLoop({
      getStatus: () => this.status,
      setStatus: (status) => {
        this.status = status
      },
      transition: transitionMeetingStatus,
      runEffect: (effect, event) => this.runEffect(effect, event),
      emitSnapshot: () => this.emitSnapshot(),
      createFailedEvent: (error) => ({ type: 'FAILED', error }),
      effectNeedsPostEmit: meetingEffectNeedsPostEmit,
      onTransition: ({ event }) => {
        if (event.type === 'FAILED' && event.error) {
          this.error = event.error
        }
      },
      onEffectFailed: ({ effect, failed }) => {
        if (effect === 'resolve-config-and-warmup') {
          this.pendingStartupFailure = failed
        }
      },
      serializeTopLevel: true,
      enableReentrantEnqueue: true
    })
  }

  getSnapshot(): MeetingRuntimeSnapshot | null {
    if (!this.activeSession) {
      return this.terminalSnapshot
    }

    const { transcript, translationEnabled } = this.liveTranscript.getSnapshotFields()

    return {
      sessionId: this.activeSession.sessionId,
      status: this.status,
      startedAt: this.activeSession.startedAt,
      durationSec: Math.max(0, Math.floor((this.now() - this.activeSession.startedAt) / 1000)),
      transcript,
      engineProfileId: this.activeSession.runtimeConfig.engineProfile.id,
      translationEnabled,
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

  async prewarm(): Promise<void> {
    const runtimeConfig = this.dependencies.settingsProvider.resolveRuntimeConfig('meeting')
    const engine = this.dependencies.engineFactory(runtimeConfig)
    await engine.warmup({
      mode: 'meeting',
      language: String(runtimeConfig.engineConfig.language)
    })
  }

  async start(input: StartMeetingCommand = {}): Promise<void> {
    if (this.activeSession || this.status !== 'idle') {
      throw new Error('Meeting session is already active')
    }

    this.pendingStartInput = input
    this.terminalSnapshot = null
    this.pendingStartupFailure = null
    await this.dispatch({ type: 'START_REQUESTED' })

    const failure = this.consumePendingStartupFailure()
    if (failure) {
      throw Object.assign(new Error(failure.message), { payload: failure })
    }
  }

  private consumePendingStartupFailure(): AppErrorPayload | null {
    const failure = this.pendingStartupFailure
    this.pendingStartupFailure = null
    return failure
  }

  async stop(): Promise<void> {
    const session = this.requireActiveSession()

    if (this.status !== 'streaming') {
      throw new Error(`Cannot stop meeting session from status "${this.status}"`)
    }

    this.awaitingStopSessionEnd = true

    try {
      await this.dispatch({ type: 'STOP_REQUESTED' })
      await session.completion.promise
    } finally {
      this.awaitingStopSessionEnd = false
    }
  }

  handleCaptureProcessGone(): void {
    if (!this.activeSession) {
      return
    }

    this.notify({
      level: 'error',
      message: 'Audio capture process crashed. The session will be saved.'
    })
    void this.dispatch({
      type: 'FAILED',
      error: {
        code: 'E_CAPTURE_UNAVAILABLE',
        message: 'The capture process crashed unexpectedly',
        retryable: false
      }
    })
  }

  private dispatch(event: MeetingSessionEvent): Promise<void> {
    return this.sessionDispatch.dispatch(event)
  }

  private enqueueControlEvent(event: MeetingSessionEvent): Promise<void> {
    return this.sessionDispatch.dispatch(event)
  }

  private async runEffect(
    effect: MeetingTransitionEffect,
    event: MeetingSessionEvent
  ): Promise<MeetingEffectResult> {
    switch (effect) {
      case 'resolve-config-and-warmup':
        return this.runResolveConfigAndWarmup()
      case 'begin-live-session':
        return {}
      case 'stop-capture-and-close-session':
        return this.runStopCaptureAndCloseSession()
      case 'record-warning':
        return {}
      case 'record-warning-and-recover':
        return this.runRecordWarningAndRecover()
      case 'finalize-transcript':
        return this.runFinalizeTranscript()
      case 'persist-transcript':
        return this.runPersistTranscript()
      case 'record-unexpected-stop':
        return this.runRecordUnexpectedStop(event)
      case 'record-error':
        return this.runRecordError(event)
      case 'clear-runtime':
        return this.runClearRuntime(event)
      default:
        return assertNever(effect)
    }
  }

  private async runResolveConfigAndWarmup(): Promise<MeetingEffectResult> {
    const input = this.pendingStartInput
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
      audioRecorder: this.dependencies.audioRecorderFactory?.({
        sessionId,
        chunkMs: runtimeConfig.captureConfig.chunkMs
      }),
      pendingPersist: null,
      completion: createCompletionSignal()
    }
    this.liveTranscript.reset(sessionId, runtimeConfig)
    this.dependencies.diagnostics?.record({
      type: 'session-started',
      timestamp: startedAt,
      sessionId,
      mode: 'meeting'
    })
    this.bindRecognitionSession(engine)

    try {
      await this.startSessionRuntime(this.activeSession, settings.input.microphoneDeviceId)
    } catch (errorLike) {
      return { failed: normalizeRecognitionError(errorLike, 'Unknown meeting error') }
    }

    return {}
  }

  private async runStopCaptureAndCloseSession(): Promise<MeetingEffectResult> {
    const session = this.requireActiveSession()

    try {
      await this.recognitionSession.stopCapture()
      await this.recognitionSession.stopSession()
    } catch (errorLike) {
      return { failed: normalizeRecognitionError(errorLike, 'Unknown meeting error') }
    }

    return { followUps: { type: 'SESSION_ENDED' } }
  }

  private async runRecordWarningAndRecover(): Promise<MeetingEffectResult> {
    const session = this.requireActiveSession()

    if (this.recoveryPromise) {
      await this.recoveryPromise
      return {}
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

    try {
      await recoveryPromise
    } catch (errorLike) {
      return { followUps: { type: 'FAILED', error: normalizeRecognitionError(errorLike, 'Unknown meeting error') } }
    }

    return {}
  }

  private async runFinalizeTranscript(): Promise<MeetingEffectResult> {
    const session = this.requireActiveSession()

    await this.liveTranscript.awaitPendingTranslations()
    const endedAt = this.now()
    const saved = this.liveTranscript.buildSavedTranscriptInput()
    const audioMetadata = await this.finalizeSessionAudio(session, 'complete')

    session.pendingPersist = {
      endedAt,
      plainText: saved.plainText,
      ...(saved.translatedPlainText ? { translatedPlainText: saved.translatedPlainText } : {}),
      audioMetadata
    }

    return { followUps: { type: 'PERSIST_SUCCEEDED' } }
  }

  private async runPersistTranscript(): Promise<MeetingEffectResult> {
    const session = this.requireActiveSession()
    const pendingPersist = session.pendingPersist

    if (!pendingPersist) {
      return {
        failed: {
          code: 'E_ENGINE_PROTOCOL',
          message: 'Meeting session finished without persisted transcript context',
          retryable: true
        }
      }
    }

    const { endedAt, plainText, translatedPlainText, audioMetadata } = pendingPersist
    const { blocks } = this.liveTranscript.buildSavedTranscriptInput()

    try {
      await this.dependencies.transcriptRepository.save(
        buildMeetingSavedTranscript({
          sessionId: session.sessionId,
          startedAt: session.startedAt,
          endedAt,
          runtimeConfig: session.runtimeConfig,
          includeMicrophone: session.includeMicrophone,
          plainText,
          ...(translatedPlainText ? { translatedPlainText } : {}),
          blocks,
          audioMetadata
        })
      )
    } catch (errorLike) {
      if (audioMetadata) {
        await this.cleanupPersistedAudio(audioMetadata)
      }

      return { followUps: { type: 'PERSIST_FAILED', error: normalizeStorageErrorPayload(errorLike) } }
    }

    this.dependencies.diagnostics?.record({
      type: 'session-persisted',
      timestamp: endedAt,
      sessionId: session.sessionId,
      blockCount: blocks.length
    })

    session.pendingPersist = null
    session.completion.settle()
    return { followUps: { type: 'RESET', clearError: true } }
  }

  private async runRecordError(event: MeetingSessionEvent): Promise<MeetingEffectResult> {
    const error = readMeetingError(event)
    const session = this.activeSession

    this.error = error
    if (session) {
      this.dependencies.diagnostics?.record({
        type: 'session-failed',
        timestamp: this.now(),
        sessionId: session.sessionId,
        errorCode: error.code
      })
    }

    await this.abortActiveRuntime(session)

    if (session) {
      await session.audioRecorder?.discard()
      if (session.audioRecorder) {
        session.audioRecorder = undefined
      }
    }

    this.terminalSnapshot = session ? this.createSnapshotForSession(session, error) : this.terminalSnapshot
    session?.completion.settle()
    return { followUps: { type: 'RESET', clearError: false } }
  }

  private async runRecordUnexpectedStop(event: MeetingSessionEvent): Promise<MeetingEffectResult> {
    const error = readMeetingError(event)
    const session = this.activeSession
    const terminalStatus = this.status

    this.error = error
    if (session) {
      this.dependencies.diagnostics?.record({
        type: 'session-failed',
        timestamp: this.now(),
        sessionId: session.sessionId,
        errorCode: error.code
      })
    }

    if (session && terminalStatus === 'stopped_unexpectedly') {
      await this.persistInterruptedSession(session)
    }

    await this.abortActiveRuntime(session)

    if (session && terminalStatus !== 'stopped_unexpectedly') {
      await session.audioRecorder?.discard()
      session.audioRecorder = undefined
    }

    this.terminalSnapshot = session ? this.createSnapshotForSession(session, error) : this.terminalSnapshot
    session?.completion.settle()
    return { followUps: { type: 'RESET', clearError: false } }
  }

  private runClearRuntime(event: MeetingSessionEvent): MeetingEffectResult {
    this.cleanupActiveSession()

    if (event.type === 'RESET' && event.clearError === false) {
      return {}
    }

    this.error = undefined
    this.terminalSnapshot = null
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
            await this.enqueueControlEvent({ type: 'SESSION_READY' })
          }
          return
        case 'draft-updated':
        case 'block-committed':
        case 'translation-updated':
          this.liveTranscript.handleRecognitionEvent(event)
          return
        case 'session-ended':
          if (this.awaitingStopSessionEnd) {
            return
          }
          if (this.status === 'finishing') {
            await this.enqueueControlEvent({ type: 'SESSION_ENDED' })
          }
          return
        case 'warning':
          this.notify({
            level: event.payload.recoverable ? 'warning' : 'error',
            message: event.payload.message
          })
          if (this.status === 'streaming' && event.payload.recoverable) {
            this.notify({
              level: 'warning',
              message: 'Attempting to recover the live session...'
            })
            await this.enqueueControlEvent({
              type: 'ENGINE_WARNING',
              recoverable: event.payload.recoverable
            })
            return
          }

          if (this.status === 'streaming') {
            await this.enqueueControlEvent({
              type: 'ENGINE_WARNING',
              recoverable: event.payload.recoverable
            })
            return
          }

          this.emitSnapshot()
          return
        case 'error':
          await this.enqueueControlEvent({ type: 'FAILED', error: event.payload })
          return
        default:
          return assertNever(event)
      }
    } catch (error) {
      await this.enqueueControlEvent({ type: 'FAILED', error: normalizeRecognitionError(error, 'Unknown meeting error') })
    }
  }

  private async handleCaptureEvent(event: RecognitionCaptureControlEvent): Promise<void> {
    const session = this.activeSession

    if (!session || event.requestId !== session.sessionId) {
      return
    }

    switch (event.type) {
      case 'capture-error':
        await this.enqueueControlEvent({ type: 'FAILED', error: event.error })
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

  private cleanupActiveSession(): void {
    this.recognitionSession.clear()
    this.liveTranscript.clear()
    this.recoveryPromise = null
    this.recoveryReadySignal = null
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

  private bindRecognitionSession(engine: RecognitionEngine): void {
    const session = this.requireActiveSession()
    this.recognitionSession.bind({
      engine,
      sessionId: session.sessionId,
      handlers: {
        onEngineEvent: (event) => {
          void this.handleEngineEvent(event)
        },
        onCaptureEvent: (event) => {
          void this.handleCaptureEvent(event)
        },
        onAudioChunk: (chunk) => {
          this.activeSession?.audioRecorder?.appendChunk(chunk)
        }
      }
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

    await this.recognitionSession.start({
      mode: 'meeting',
      sources: getMeetingSources(session.includeMicrophone),
      runtimeConfig: session.runtimeConfig,
      ...(session.includeMicrophone ? { microphoneDeviceId } : {}),
      explicitWarmup: true,
      startCapture: restartCapture
    })
  }

  private async performRecovery(
    session: MeetingSessionContext,
    recoveryReadySignal: { promise: Promise<void>; settle: () => void }
  ): Promise<void> {
    // Keep engine-only abort on the Recognition Session so recovery does not tear down capture.
    await this.recognitionSession.abort({ abortCapture: false })

    const settings = this.dependencies.settingsProvider.getSettings()
    const nextEngine = this.dependencies.engineFactory(session.runtimeConfig)
    session.engine = nextEngine
    this.recognitionSession.rebind(nextEngine)

    await this.startSessionRuntime(session, settings.input.microphoneDeviceId, false)
    await waitForRecoveryReady(
      recoveryReadySignal.promise,
      this.recoveryTimeoutMs,
      'Meeting recovery timed out before the engine became ready'
    )

    if (this.activeSession?.sessionId !== session.sessionId || this.status !== 'recovering') {
      return
    }

    const result = transitionMeetingStatus(this.status, { type: 'RECOVERY_SUCCEEDED' })
    this.status = result.to
    this.error = undefined
    this.emitSnapshot()
    this.notify({
      level: 'info',
      message: 'Live session recovered.'
    })
  }

  private createSnapshotForSession(
    session: MeetingSessionContext,
    error: AppErrorPayload | undefined = this.error
  ): MeetingRuntimeSnapshot {
    const { transcript, translationEnabled } = this.liveTranscript.getSnapshotFields()

    return {
      sessionId: session.sessionId,
      status: this.status,
      startedAt: session.startedAt,
      durationSec: Math.max(0, Math.floor((this.now() - session.startedAt) / 1000)),
      transcript,
      engineProfileId: session.runtimeConfig.engineProfile.id,
      translationEnabled,
      ...(error ? { error: { ...error } } : {})
    }
  }

  private requireActiveSession(): MeetingSessionContext {
    if (!this.activeSession) {
      throw new Error('No active meeting session')
    }

    return this.activeSession
  }

  private async abortActiveRuntime(_session: MeetingSessionContext | null): Promise<void> {
    await this.recognitionSession.abort()
  }

  private async persistInterruptedSession(session: MeetingSessionContext): Promise<void> {
    await this.liveTranscript.awaitPendingTranslations()
    const endedAt = this.now()
    const { plainText, translatedPlainText, blocks } = this.liveTranscript.buildSavedTranscriptInput()
    const audioMetadata = await this.finalizeSessionAudio(session, 'partial')
    const hasTranscriptContent = plainText.trim().length > 0 || blocks.length > 0

    if (!hasTranscriptContent && !audioMetadata) {
      return
    }

    try {
      await this.dependencies.transcriptRepository.save(
        buildMeetingSavedTranscript({
          sessionId: session.sessionId,
          startedAt: session.startedAt,
          endedAt,
          runtimeConfig: session.runtimeConfig,
          includeMicrophone: session.includeMicrophone,
          plainText,
          ...(translatedPlainText ? { translatedPlainText } : {}),
          blocks,
          audioMetadata
        })
      )
      this.dependencies.diagnostics?.record({
        type: 'session-persisted',
        timestamp: endedAt,
        sessionId: session.sessionId,
        blockCount: blocks.length
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

function meetingEffectNeedsPostEmit(effect: MeetingTransitionEffect): boolean {
  switch (effect) {
    case 'resolve-config-and-warmup':
    case 'clear-runtime':
    case 'record-error':
    case 'record-unexpected-stop':
      return true
    default:
      return false
  }
}

function readMeetingError(event: MeetingSessionEvent): AppErrorPayload {
  if (
    (event.type === 'FAILED' || event.type === 'PERSIST_FAILED' || event.type === 'RECOVERY_FAILED') &&
    event.error
  ) {
    return event.error
  }

  return {
    code: 'E_ENGINE_PROTOCOL',
    message: 'Unknown meeting error',
    retryable: true
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

function normalizeStorageErrorPayload(errorLike: unknown): AppErrorPayload {
  return {
    code: 'E_STORAGE_WRITE',
    message: errorLike instanceof Error ? errorLike.message : 'Failed to persist meeting transcript',
    retryable: true
  }
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
