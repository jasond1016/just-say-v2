import type { AppErrorPayload, AudioChunk, CaptureCommand, CaptureEvent } from '../../shared/api-types'
import type { CaptureSource } from '../../shared/primitive-types'
import type { CaptureApi } from '../../preload/capture'

export interface CaptureSourceInstance {
  onChunk(listener: (chunk: AudioChunk) => void): () => void
  start(): Promise<void>
  stop(): Promise<void>
  abort(): Promise<void>
}

export interface CaptureSourceManager {
  createSource(input: {
    requestId: string
    source: CaptureSource
    microphoneDeviceId?: string
    systemSourceId?: string
    sampleRate: number
    chunkMs: number
  }): Promise<CaptureSourceInstance>
}

type ActiveCaptureSession = {
  requestId: string
  sources: CaptureSource[]
  instances: CaptureSourceInstance[]
  releaseChunkListeners: Array<() => void>
}

export class CaptureRuntime {
  private readonly stopListening: () => void
  private activeSession: ActiveCaptureSession | null = null

  constructor(
    private readonly api: CaptureApi,
    private readonly sourceManager: CaptureSourceManager
  ) {
    this.stopListening = this.api.onCommand((command) => {
      void this.handleCommand(command)
    })
  }

  start(): void {
    this.api.notifyReady()
  }

  dispose(): void {
    this.stopListening()

    if (this.activeSession) {
      void this.abortActiveSession(this.activeSession)
      this.activeSession = null
    }
  }

  private async handleCommand(command: CaptureCommand): Promise<void> {
    switch (command.type) {
      case 'start':
        await this.startCapture(command)
        return
      case 'stop':
        await this.stopCapture(command.requestId, 'stop')
        return
      case 'abort':
        await this.stopCapture(command.requestId, 'abort')
        return
      default:
        return assertNever(command)
    }
  }

  private async startCapture(command: Extract<CaptureCommand, { type: 'start' }>): Promise<void> {
    if (this.activeSession) {
      this.api.sendEvent({
        type: 'capture-error',
        requestId: command.requestId,
        error: buildCaptureError('E_CAPTURE_UNAVAILABLE', 'Another capture session is already active', true)
      })
      return
    }

    const instances: CaptureSourceInstance[] = []
    const releaseChunkListeners: Array<() => void> = []

    try {
      for (const source of command.sources) {
        const instance = await this.sourceManager.createSource({
          requestId: command.requestId,
          source,
          ...(command.microphoneDeviceId ? { microphoneDeviceId: command.microphoneDeviceId } : {}),
          ...(command.systemSourceId ? { systemSourceId: command.systemSourceId } : {}),
          sampleRate: command.sampleRate,
          chunkMs: command.chunkMs
        })

        releaseChunkListeners.push(
          instance.onChunk((chunk) => {
            this.api.sendEvent({
              type: 'audio-chunk',
              requestId: command.requestId,
              chunk
            })
          })
        )
        instances.push(instance)
      }

      this.activeSession = {
        requestId: command.requestId,
        sources: [...command.sources],
        instances,
        releaseChunkListeners
      }

      await Promise.all(instances.map((instance) => instance.start()))
      this.api.sendEvent({
        type: 'capture-started',
        requestId: command.requestId,
        sources: [...command.sources]
      })
    } catch (error) {
      await Promise.allSettled(instances.map((instance) => instance.abort()))
      this.releaseChunkListeners(releaseChunkListeners)
      this.activeSession = null
      this.api.sendEvent({
        type: 'capture-error',
        requestId: command.requestId,
        error: normalizeCaptureError(error)
      })
    }
  }

  private async stopCapture(requestId: string, mode: 'stop' | 'abort'): Promise<void> {
    const session = this.activeSession

    if (!session || session.requestId !== requestId) {
      return
    }

    if (mode === 'stop') {
      await Promise.all(session.instances.map((instance) => instance.stop()))
    } else {
      await this.abortActiveSession(session)
    }

    this.releaseChunkListeners(session.releaseChunkListeners)
    this.activeSession = null
    this.api.sendEvent({
      type: 'capture-stopped',
      requestId
    })
  }

  private async abortActiveSession(session: ActiveCaptureSession): Promise<void> {
    await Promise.allSettled(session.instances.map((instance) => instance.abort()))
    this.releaseChunkListeners(session.releaseChunkListeners)
  }

  private releaseChunkListeners(releaseChunkListeners: Array<() => void>): void {
    for (const release of releaseChunkListeners) {
      release()
    }
  }
}

function normalizeCaptureError(errorLike: unknown): AppErrorPayload {
  if (isAppErrorPayload(errorLike)) {
    return errorLike
  }

  if (errorLike instanceof Error) {
    return buildCaptureError('E_CAPTURE_UNAVAILABLE', errorLike.message, true)
  }

  return buildCaptureError('E_CAPTURE_UNAVAILABLE', 'Unknown capture error', true)
}

function buildCaptureError(
  code: AppErrorPayload['code'],
  message: string,
  retryable: boolean
): AppErrorPayload {
  return {
    code,
    message,
    retryable
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

function assertNever(value: never): never {
  throw new Error(`Unhandled capture command: ${String(value)}`)
}
