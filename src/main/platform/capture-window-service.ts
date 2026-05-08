import type {
  AppErrorCode,
  AppErrorPayload,
  CaptureCommand,
  CaptureEvent
} from '../../shared/api-types'
import type { CaptureSource } from '../../shared/primitive-types'

export type CaptureRequestStatus = 'starting' | 'capturing' | 'stopping'

export type ActiveCaptureRequest = {
  requestId: string
  sources: CaptureSource[]
  status: CaptureRequestStatus
  startedAt: number | null
}

export type CaptureWindowServiceState = {
  activeRequest: ActiveCaptureRequest | null
  lastError: AppErrorPayload | null
}

export type StartCaptureInput = {
  requestId?: string
  sources: CaptureSource[]
  microphoneDeviceId?: string
  systemSourceId?: string
  sampleRate?: number
  chunkMs?: number
}

type CaptureEventListener = (event: CaptureEvent) => void
type Unsubscribe = () => void

export interface CaptureWindowTransport {
  ensureReady(): Promise<void>
  sendCommand(command: CaptureCommand): Promise<void>
  onEvent(listener: CaptureEventListener): Unsubscribe
}

export type CaptureWindowServiceOptions = {
  createRequestId?: () => string
  now?: () => number
}

const DEFAULT_SAMPLE_RATE = 16000
const DEFAULT_CHUNK_MS = 100

export class CaptureWindowService {
  private readonly listeners = new Set<CaptureEventListener>()
  private readonly transportUnsubscribe: Unsubscribe
  private readonly createRequestId: () => string
  private readonly now: () => number
  private readyPromise: Promise<void> | null = null
  private state: CaptureWindowServiceState = {
    activeRequest: null,
    lastError: null
  }

  constructor(
    private readonly transport: CaptureWindowTransport,
    options: CaptureWindowServiceOptions = {}
  ) {
    this.createRequestId = options.createRequestId ?? defaultCreateRequestId
    this.now = options.now ?? Date.now
    this.transportUnsubscribe = this.transport.onEvent((event) => {
      this.handleEvent(event)
    })
  }

  getState(): CaptureWindowServiceState {
    return {
      activeRequest: this.state.activeRequest
        ? {
            ...this.state.activeRequest,
            sources: [...this.state.activeRequest.sources]
          }
        : null,
      lastError: this.state.lastError ? { ...this.state.lastError } : null
    }
  }

  onEvent(listener: CaptureEventListener): Unsubscribe {
    this.listeners.add(listener)

    return () => {
      this.listeners.delete(listener)
    }
  }

  dispose(): void {
    this.transportUnsubscribe()
    this.listeners.clear()
    this.readyPromise = null
    this.state = {
      activeRequest: null,
      lastError: null
    }
  }

  async ensureReady(): Promise<void> {
    if (!this.readyPromise) {
      this.readyPromise = this.transport.ensureReady().catch((error) => {
        this.readyPromise = null
        throw error
      })
    }

    await this.readyPromise
  }

  async startCapture(input: StartCaptureInput): Promise<ActiveCaptureRequest> {
    const sources = normalizeSources(input.sources)

    if (sources.length === 0) {
      throw createCaptureWindowServiceError(
        'E_INVALID_SETTINGS',
        'Capture requires at least one source',
        false
      )
    }

    if (this.state.activeRequest) {
      throw createCaptureWindowServiceError(
        'E_CAPTURE_UNAVAILABLE',
        'A capture request is already active',
        true,
        { activeRequestId: this.state.activeRequest.requestId }
      )
    }

    await this.ensureReady()

    const requestId = input.requestId ?? this.createRequestId()
    const command: CaptureCommand = {
      type: 'start',
      requestId,
      sources,
      sampleRate: input.sampleRate ?? DEFAULT_SAMPLE_RATE,
      chunkMs: input.chunkMs ?? DEFAULT_CHUNK_MS,
      ...(sources.includes('microphone') && input.microphoneDeviceId !== undefined
        ? { microphoneDeviceId: input.microphoneDeviceId }
        : {}),
      ...(sources.includes('system') && input.systemSourceId !== undefined
        ? { systemSourceId: input.systemSourceId }
        : {})
    }

    this.state = {
      activeRequest: {
        requestId,
        sources,
        status: 'starting',
        startedAt: null
      },
      lastError: null
    }

    try {
      await this.transport.sendCommand(command)
    } catch (error) {
      this.state = {
        activeRequest: null,
        lastError: null
      }
      throw error
    }

    return this.getRequiredActiveRequest()
  }

  async stopCapture(requestId = this.state.activeRequest?.requestId): Promise<boolean> {
    if (!requestId || !this.state.activeRequest || this.state.activeRequest.requestId !== requestId) {
      return false
    }

    this.state = {
      ...this.state,
      activeRequest: {
        ...this.state.activeRequest,
        status: 'stopping'
      }
    }

    await this.transport.sendCommand({
      type: 'stop',
      requestId
    })

    return true
  }

  async abortCapture(requestId = this.state.activeRequest?.requestId): Promise<boolean> {
    if (!requestId || !this.state.activeRequest || this.state.activeRequest.requestId !== requestId) {
      return false
    }

    this.state = {
      ...this.state,
      activeRequest: {
        ...this.state.activeRequest,
        status: 'stopping'
      }
    }

    await this.transport.sendCommand({
      type: 'abort',
      requestId
    })

    return true
  }

  private handleEvent(event: CaptureEvent): void {
    if (this.state.activeRequest && this.state.activeRequest.requestId === event.requestId) {
      switch (event.type) {
        case 'capture-started':
          this.state = {
            ...this.state,
            activeRequest: {
              ...this.state.activeRequest,
              status: 'capturing',
              startedAt: this.now(),
              sources: [...event.sources]
            }
          }
          break
        case 'capture-stopped':
          this.state = {
            ...this.state,
            activeRequest: null
          }
          break
        case 'capture-error':
          this.state = {
            activeRequest: null,
            lastError: event.error
          }
          break
        case 'audio-chunk':
          break
        default:
          assertNever(event)
      }
    }

    for (const listener of this.listeners) {
      listener(event)
    }
  }

  private getRequiredActiveRequest(): ActiveCaptureRequest {
    if (!this.state.activeRequest) {
      throw createCaptureWindowServiceError(
        'E_CAPTURE_UNAVAILABLE',
        'Capture request disappeared unexpectedly',
        true
      )
    }

    return {
      ...this.state.activeRequest,
      sources: [...this.state.activeRequest.sources]
    }
  }
}

function normalizeSources(sources: CaptureSource[]): CaptureSource[] {
  const seen = new Set<CaptureSource>()
  const normalized: CaptureSource[] = []

  for (const source of sources) {
    if (seen.has(source)) {
      continue
    }

    seen.add(source)
    normalized.push(source)
  }

  return normalized
}

function createCaptureWindowServiceError(
  code: AppErrorCode,
  message: string,
  retryable: boolean,
  detail?: Record<string, unknown>
): Error {
  const error = new Error(message)
  ;(error as Error & { payload?: AppErrorPayload }).payload = {
    code,
    message,
    retryable,
    ...(detail !== undefined ? { detail } : {})
  }

  return error
}

function defaultCreateRequestId(): string {
  return `capture-${Date.now()}`
}

function assertNever(value: never): never {
  throw new Error(`Unhandled capture event: ${String(value)}`)
}
