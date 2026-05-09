import type { AppErrorPayload, LocalServiceStatus } from '../../shared/api-types'

export type LocalServiceHealthResult = {
  ok: boolean
  degraded?: boolean
  detail?: Record<string, unknown>
}

export interface LocalServiceController {
  start(): Promise<void>
  stop(): Promise<void>
  healthCheck(): Promise<LocalServiceHealthResult>
}

export class LocalServiceSupervisor {
  private status: LocalServiceStatus = 'stopped'
  private lastError: AppErrorPayload | null = null
  private inFlightEnsureReady: Promise<LocalServiceStatus> | null = null
  private readonly listeners = new Set<(status: LocalServiceStatus) => void>()

  constructor(private readonly controller: LocalServiceController) {}

  getStatus(): LocalServiceStatus {
    return this.status
  }

  getLastError(): AppErrorPayload | null {
    return this.lastError ? { ...this.lastError } : null
  }

  onStatusChange(listener: (status: LocalServiceStatus) => void): () => void {
    this.listeners.add(listener)

    return () => {
      this.listeners.delete(listener)
    }
  }

  async ensureReady(): Promise<LocalServiceStatus> {
    if (this.status === 'healthy' || this.status === 'degraded') {
      return this.status
    }

    if (this.inFlightEnsureReady) {
      return this.inFlightEnsureReady
    }

    this.transitionTo('starting')
    this.inFlightEnsureReady = this.bootstrap().finally(() => {
      this.inFlightEnsureReady = null
    })

    return this.inFlightEnsureReady
  }

  async stop(): Promise<void> {
    await this.controller.stop()
    this.lastError = null
    this.transitionTo('stopped')
  }

  private async bootstrap(): Promise<LocalServiceStatus> {
    try {
      await this.controller.start()
      const health = await this.controller.healthCheck()

      if (!health.ok) {
        const error = createLocalServiceError(
          'Local service health check failed',
          health.detail
        )
        this.lastError = error
        this.transitionTo('failed')
        throw error
      }

      this.lastError = null
      const nextStatus: LocalServiceStatus = health.degraded ? 'degraded' : 'healthy'
      this.transitionTo(nextStatus)
      return nextStatus
    } catch (errorLike) {
      const error = normalizeLocalServiceError(errorLike)
      this.lastError = error
      this.transitionTo('failed')
      throw error
    }
  }

  private transitionTo(status: LocalServiceStatus): void {
    if (this.status === status) {
      return
    }

    this.status = status
    for (const listener of this.listeners) {
      listener(status)
    }
  }
}

function createLocalServiceError(
  message: string,
  detail?: Record<string, unknown>
): AppErrorPayload {
  return {
    code: 'E_LOCAL_SERVICE_START',
    message,
    retryable: true,
    ...(detail ? { detail } : {})
  }
}

function normalizeLocalServiceError(errorLike: unknown): AppErrorPayload {
  if (isAppErrorPayload(errorLike)) {
    return errorLike
  }

  if (errorLike instanceof Error) {
    return createLocalServiceError(errorLike.message)
  }

  return createLocalServiceError('Unknown local service error')
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
