import type { AppErrorPayload, AppRuntimeSnapshot, PttHudSnapshot } from '../../shared/api-types'

type SessionServiceLike = {
  getRuntimeSnapshot(): AppRuntimeSnapshot
  onSnapshot(listener: (snapshot: AppRuntimeSnapshot) => void): () => void
  copyLatestPttText(): Promise<void>
}

type TimerHandle = ReturnType<typeof setInterval>
type TimeoutHandle = ReturnType<typeof setTimeout>

export type PttHudServiceOptions = {
  now?: () => number
  setInterval?: typeof setInterval
  clearInterval?: typeof clearInterval
  setTimeout?: typeof setTimeout
  clearTimeout?: typeof clearTimeout
  sentFlashMs?: number
  recordingTickMs?: number
}

export class PttHudService {
  private readonly now: () => number
  private readonly startInterval: typeof setInterval
  private readonly stopInterval: typeof clearInterval
  private readonly startTimeout: typeof setTimeout
  private readonly stopTimeout: typeof clearTimeout
  private readonly sentFlashMs: number
  private readonly recordingTickMs: number
  private readonly unsubscribeRuntime: () => void
  private readonly listeners = new Set<(snapshot: PttHudSnapshot) => void>()
  private runtimeSnapshot: AppRuntimeSnapshot
  private snapshot: PttHudSnapshot = { mode: 'hidden' }
  private recordingStartedAt: number | null = null
  private recordingTicker: TimerHandle | null = null
  private sentHideTimeout: TimeoutHandle | null = null
  private dismissedRecoveryKey: string | null = null

  constructor(
    private readonly sessionService: SessionServiceLike,
    options: PttHudServiceOptions = {}
  ) {
    this.now = options.now ?? Date.now
    this.startInterval = options.setInterval ?? setInterval
    this.stopInterval = options.clearInterval ?? clearInterval
    this.startTimeout = options.setTimeout ?? setTimeout
    this.stopTimeout = options.clearTimeout ?? clearTimeout
    this.sentFlashMs = options.sentFlashMs ?? 820
    this.recordingTickMs = options.recordingTickMs ?? 250
    this.runtimeSnapshot = sessionService.getRuntimeSnapshot()
    this.unsubscribeRuntime = sessionService.onSnapshot((snapshot) => {
      this.runtimeSnapshot = snapshot
      this.applyRuntimeSnapshot(snapshot)
    })
    this.applyRuntimeSnapshot(this.runtimeSnapshot)
  }

  dispose(): void {
    this.unsubscribeRuntime()
    this.stopRecordingTicker()
    this.clearSentHideTimeout()
    this.listeners.clear()
  }

  getSnapshot(): PttHudSnapshot {
    return cloneHudSnapshot(this.snapshot)
  }

  onSnapshot(listener: (snapshot: PttHudSnapshot) => void): () => void {
    this.listeners.add(listener)

    return () => {
      this.listeners.delete(listener)
    }
  }

  async dismiss(): Promise<void> {
    if (this.snapshot.mode === 'recovery') {
      this.dismissedRecoveryKey = getRecoveryKey(this.runtimeSnapshot.ptt.error)
    }

    this.stopRecordingTicker()
    this.clearSentHideTimeout()
    this.setSnapshot({ mode: 'hidden' })
  }

  async copyLatestText(): Promise<void> {
    await this.sessionService.copyLatestPttText()
    this.dismissedRecoveryKey = null
    this.showSentState()
  }

  private applyRuntimeSnapshot(snapshot: AppRuntimeSnapshot): void {
    const ptt = snapshot.ptt

    if (ptt.status === 'arming' || ptt.status === 'capturing') {
      this.dismissedRecoveryKey = null
      this.clearSentHideTimeout()
      this.startRecordingState()
      return
    }

    this.stopRecordingTicker()

    if (
      ptt.status === 'recognizing' ||
      ptt.status === 'post_processing' ||
      ptt.status === 'delivering'
    ) {
      this.dismissedRecoveryKey = null
      this.clearSentHideTimeout()
      this.setSnapshot({ mode: 'processing' })
      return
    }

    if (ptt.status === 'completed') {
      this.dismissedRecoveryKey = null
      this.showSentState()
      return
    }

    if (ptt.error) {
      this.clearSentHideTimeout()
      const recoveryKey = getRecoveryKey(ptt.error)

      if (recoveryKey === this.dismissedRecoveryKey) {
        this.setSnapshot({ mode: 'hidden' })
        return
      }

      this.setSnapshot(buildRecoverySnapshot(ptt.error))
      return
    }

    if (this.snapshot.mode === 'sent' && this.sentHideTimeout) {
      return
    }

    this.recordingStartedAt = null
    this.setSnapshot({ mode: 'hidden' })
  }

  private startRecordingState(): void {
    if (this.recordingStartedAt === null) {
      this.recordingStartedAt = this.now()
    }

    this.emitRecordingSnapshot()

    if (this.recordingTicker) {
      return
    }

    this.recordingTicker = this.startInterval(() => {
      this.emitRecordingSnapshot()
    }, this.recordingTickMs)
  }

  private stopRecordingTicker(): void {
    if (this.recordingTicker) {
      this.stopInterval(this.recordingTicker)
      this.recordingTicker = null
    }

    this.recordingStartedAt = null
  }

  private emitRecordingSnapshot(): void {
    const startedAt = this.recordingStartedAt ?? this.now()
    this.setSnapshot({
      mode: 'recording',
      elapsedMs: Math.max(0, this.now() - startedAt)
    })
  }

  private showSentState(): void {
    this.stopRecordingTicker()
    this.clearSentHideTimeout()
    this.setSnapshot({ mode: 'sent' })
    this.sentHideTimeout = this.startTimeout(() => {
      this.sentHideTimeout = null

      if (this.runtimeSnapshot.ptt.error) {
        this.applyRuntimeSnapshot(this.runtimeSnapshot)
        return
      }

      if (isPttActive(this.runtimeSnapshot)) {
        this.applyRuntimeSnapshot(this.runtimeSnapshot)
        return
      }

      this.setSnapshot({ mode: 'hidden' })
    }, this.sentFlashMs)
  }

  private clearSentHideTimeout(): void {
    if (this.sentHideTimeout) {
      this.stopTimeout(this.sentHideTimeout)
      this.sentHideTimeout = null
    }
  }

  private setSnapshot(nextSnapshot: PttHudSnapshot): void {
    if (isSameHudSnapshot(this.snapshot, nextSnapshot)) {
      return
    }

    this.snapshot = cloneHudSnapshot(nextSnapshot)

    for (const listener of this.listeners) {
      listener(this.getSnapshot())
    }
  }
}

function buildRecoverySnapshot(error: AppErrorPayload): PttHudSnapshot {
  switch (error.code) {
    case 'E_OUTPUT_DELIVERY':
      return {
        mode: 'recovery',
        tone: 'warning',
        title: 'Couldn’t type automatically',
        body: 'Copy to clipboard, then paste.',
        canCopy: true
      }
    case 'E_NO_SPEECH_DETECTED':
      return {
        mode: 'recovery',
        tone: 'warning',
        title: 'No speech detected',
        body: 'Try again a little closer to the microphone.',
        canCopy: false
      }
    case 'E_ENGINE_UNAVAILABLE':
    case 'E_LOCAL_SERVICE_START':
      return {
        mode: 'recovery',
        tone: 'danger',
        title: 'Speech service unavailable',
        body: 'Wait a moment, then try again.',
        canCopy: false
      }
    default:
      return {
        mode: 'recovery',
        tone: 'danger',
        title: 'Dictation failed',
        body: 'Dismiss this, then try again.',
        canCopy: false
      }
  }
}

function getRecoveryKey(error: AppErrorPayload | undefined): string | null {
  if (!error) {
    return null
  }

  return `${error.code}:${error.message}`
}

function isPttActive(snapshot: AppRuntimeSnapshot): boolean {
  return snapshot.ptt.status !== 'idle'
}

function cloneHudSnapshot(snapshot: PttHudSnapshot): PttHudSnapshot {
  return { ...snapshot }
}

function isSameHudSnapshot(current: PttHudSnapshot, next: PttHudSnapshot): boolean {
  if (current.mode !== next.mode) {
    return false
  }

  switch (current.mode) {
    case 'hidden':
    case 'processing':
    case 'sent':
      return true
    case 'recording':
      return next.mode === 'recording' && current.elapsedMs === next.elapsedMs
    case 'recovery':
      return (
        next.mode === 'recovery' &&
        current.tone === next.tone &&
        current.title === next.title &&
        current.body === next.body &&
        current.canCopy === next.canCopy
      )
    default:
      return false
  }
}
