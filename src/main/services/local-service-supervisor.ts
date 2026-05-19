import type {
  AppErrorPayload,
  LocalServiceStatus,
  ResolvedLocalServiceConfig,
  RuntimeIdentity,
  RuntimeReadiness
} from '../../shared/api-types'
import type { SessionMode } from '../../shared/primitive-types'

export type LocalServiceHealthResult = RuntimeIdentity & {
  ok: boolean
  readiness: RuntimeReadiness
  degraded?: boolean
  detail?: Record<string, unknown>
}

export interface LocalServiceController {
  start(target: ResolvedLocalServiceConfig): Promise<void>
  stop(): Promise<void>
  healthCheck(target: ResolvedLocalServiceConfig): Promise<LocalServiceHealthResult>
  prewarm(
    target: ResolvedLocalServiceConfig,
    input: {
      mode: SessionMode
      language: string
    }
  ): Promise<LocalServiceHealthResult>
}

export class LocalServiceSupervisor {
  private status: LocalServiceStatus = 'stopped'
  private lastError: AppErrorPayload | null = null
  private inFlightEnsureReady: Promise<LocalServiceStatus> | null = null
  private inFlightTargetSignature: string | null = null
  private activeTargetSignature: string | null = null
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

  async ensureReady(target: ResolvedLocalServiceConfig): Promise<LocalServiceStatus> {
    const targetSignature = getTargetSignature(target)

    if (
      this.activeTargetSignature === targetSignature &&
      (this.status === 'healthy' || this.status === 'degraded')
    ) {
      return this.status
    }

    if (this.inFlightEnsureReady && this.inFlightTargetSignature === targetSignature) {
      return this.inFlightEnsureReady
    }

    this.transitionTo('starting')
    this.inFlightTargetSignature = targetSignature
    this.activeTargetSignature = targetSignature
    this.inFlightEnsureReady = this.bootstrap().finally(() => {
      this.inFlightEnsureReady = null
      this.inFlightTargetSignature = null
    })

    return this.inFlightEnsureReady
  }

  async probe(target: ResolvedLocalServiceConfig): Promise<LocalServiceStatus> {
    if (this.inFlightEnsureReady && this.inFlightTargetSignature === getTargetSignature(target)) {
      return this.inFlightEnsureReady
    }

    try {
      const health = await this.controller.healthCheck(target)

      if (!health.ok) {
        this.lastError = createLocalServiceError('Local service health check failed', health.detail)
        this.transitionTo('failed')
        return 'failed'
      }

      this.lastError = null
      this.activeTargetSignature = getTargetSignature(target)
      const nextStatus: LocalServiceStatus =
        health.degraded || health.readiness === 'prewarm-required' ? 'degraded' : 'healthy'
      this.transitionTo(nextStatus)
      return nextStatus
    } catch (errorLike) {
      this.lastError = normalizeLocalServiceError(errorLike)
      this.transitionTo('stopped')
      return 'stopped'
    }
  }

  async prewarm(
    target: ResolvedLocalServiceConfig,
    input: {
      mode: SessionMode
      language: string
    }
  ): Promise<LocalServiceHealthResult> {
    await this.ensureReady(target)

    try {
      const health = await this.controller.prewarm(target, input)

      if (!health.ok) {
        const error = createLocalServiceError('Local service prewarm failed', health.detail)
        this.lastError = error
        this.transitionTo('failed')
        throw error
      }

      this.lastError = null
      this.activeTargetSignature = getTargetSignature(target)
      const nextStatus: LocalServiceStatus =
        health.degraded || health.readiness === 'prewarm-required' ? 'degraded' : 'healthy'
      this.transitionTo(nextStatus)
      return health
    } catch (errorLike) {
      const error = normalizeLocalServiceError(errorLike)
      this.lastError = error
      this.transitionTo('failed')
      throw error
    }
  }

  setFailure(error: AppErrorPayload): LocalServiceStatus {
    this.lastError = { ...error }
    this.transitionTo('failed')
    return this.status
  }

  async stop(): Promise<void> {
    await this.controller.stop()
    this.lastError = null
    this.transitionTo('stopped')
  }

  async restart(target: ResolvedLocalServiceConfig): Promise<LocalServiceStatus> {
    await this.stop()
    return this.ensureReady(target)
  }

  private async bootstrap(): Promise<LocalServiceStatus> {
    const targetSignature = this.activeTargetSignature

    if (!targetSignature) {
      throw createLocalServiceError('Local service target is unavailable')
    }

    try {
      const target = JSON.parse(targetSignature) as ResolvedLocalServiceConfig
      await this.controller.start(target)
      const health = await this.controller.healthCheck(target)

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
      const nextStatus: LocalServiceStatus =
        health.degraded || health.readiness === 'prewarm-required' ? 'degraded' : 'healthy'
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

function getTargetSignature(target: ResolvedLocalServiceConfig): string {
  return JSON.stringify(target)
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
