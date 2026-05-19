import path from 'node:path'
import type { AppErrorPayload, ResolvedLocalServiceConfig } from '../../shared/api-types'
import type { WebSocketLike } from './python-local-service-controller'
import {
  createLocalServiceUrl,
  defaultWebSocketFactory,
  PythonLocalServiceController,
  sendLocalServiceRequest
} from './python-local-service-controller'
import type { LocalServiceController, LocalServiceHealthResult } from './local-service-supervisor'
import type { SessionMode } from '../../shared/primitive-types'

type ManagedRuntimePaths = {
  sensevoice: string
  'qwen3-asr': string
}

type ManagedLocalServiceConfig = ResolvedLocalServiceConfig & {
  mode: 'managed-local'
  servicePath: string
}

type RemoteLocalServiceConfig = ResolvedLocalServiceConfig & {
  mode: 'remote-service'
}

type InvalidLocalServiceConfig = {
  mode: 'invalid'
  error: AppErrorPayload
}

export type LocalServiceControllerConfig =
  | ManagedLocalServiceConfig
  | RemoteLocalServiceConfig
  | InvalidLocalServiceConfig

export type ConfigurableLocalServiceControllerOptions = {
  managedRuntimePaths: ManagedRuntimePaths
  healthTimeoutMs?: number
  webSocketFactory?: (url: string) => WebSocketLike
  createManagedController?: (config: ManagedLocalServiceConfig) => LocalServiceController
  createRemoteController?: (config: RemoteLocalServiceConfig) => LocalServiceController
}

export class ConfigurableLocalServiceController implements LocalServiceController {
  private readonly healthTimeoutMs: number
  private readonly webSocketFactory: (url: string) => WebSocketLike
  private readonly createManagedController: (config: ManagedLocalServiceConfig) => LocalServiceController
  private readonly createRemoteController: (config: RemoteLocalServiceConfig) => LocalServiceController
  private activeController: LocalServiceController | null = null
  private activeSignature: string | null = null

  constructor(private readonly options: ConfigurableLocalServiceControllerOptions) {
    this.healthTimeoutMs = options.healthTimeoutMs ?? 10_000
    this.webSocketFactory = options.webSocketFactory ?? defaultWebSocketFactory
    this.createManagedController =
      options.createManagedController ?? ((config) => this.createDefaultManagedController(config))
    this.createRemoteController =
      options.createRemoteController ?? ((config) => this.createDefaultRemoteController(config))
  }

  async start(target: ResolvedLocalServiceConfig): Promise<void> {
    const controller = await this.resolveController(target)
    await controller.start(target)
  }

  async stop(): Promise<void> {
    if (!this.activeController) {
      return
    }

    await this.activeController.stop()
    this.activeController = null
    this.activeSignature = null
  }

  async healthCheck(target: ResolvedLocalServiceConfig): Promise<LocalServiceHealthResult> {
    const controller = await this.resolveController(target)
    return controller.healthCheck(target)
  }

  async prewarm(
    target: ResolvedLocalServiceConfig,
    input: {
      mode: SessionMode
      language: string
    }
  ): Promise<LocalServiceHealthResult> {
    const controller = await this.resolveController(target)
    return controller.prewarm(target, input)
  }

  private async resolveController(target: ResolvedLocalServiceConfig): Promise<LocalServiceController> {
    const config = resolveLocalServiceControllerConfig(target, this.options.managedRuntimePaths)
    const signature = JSON.stringify(config)

    if (this.activeController && this.activeSignature === signature) {
      return this.activeController
    }

    if (this.activeController) {
      await this.activeController.stop()
    }

    this.activeController = this.createController(config)
    this.activeSignature = signature
    return this.activeController
  }

  private createController(config: LocalServiceControllerConfig): LocalServiceController {
    switch (config.mode) {
      case 'managed-local':
        return this.createManagedController(config)
      case 'remote-service':
        return this.createRemoteController(config)
      case 'invalid':
        return new InvalidLocalServiceController(config.error)
      default:
        return assertNever(config)
    }
  }

  private createDefaultManagedController(config: ManagedLocalServiceConfig): LocalServiceController {
    return new PythonLocalServiceController({
      host: config.host,
      port: config.port,
      modelName: config.modelIdentifier,
      scriptPath: path.join(config.servicePath, 'service.py'),
      workingDirectory: config.servicePath,
      env: {
        JUSTSAY_LOCAL_SERVICE_RUNTIME_FAMILY: config.runtimeFamilyId
      },
      healthTimeoutMs: this.healthTimeoutMs,
      webSocketFactory: this.webSocketFactory
    })
  }

  private createDefaultRemoteController(config: RemoteLocalServiceConfig): LocalServiceController {
    return new RemoteLocalServiceController({
      ...config,
      healthTimeoutMs: this.healthTimeoutMs,
      webSocketFactory: this.webSocketFactory
    })
  }
}

export class RemoteLocalServiceController implements LocalServiceController {
  private readonly healthTimeoutMs: number
  private readonly webSocketFactory: (url: string) => WebSocketLike

  constructor(
    private readonly options: RemoteLocalServiceConfig & {
      healthTimeoutMs?: number
      webSocketFactory?: (url: string) => WebSocketLike
    }
  ) {
    this.healthTimeoutMs = options.healthTimeoutMs ?? 10_000
    this.webSocketFactory = options.webSocketFactory ?? defaultWebSocketFactory
  }

  async start(_target: ResolvedLocalServiceConfig): Promise<void> {}

  async stop(): Promise<void> {}

  async healthCheck(_target: ResolvedLocalServiceConfig): Promise<LocalServiceHealthResult> {
    const response = await sendLocalServiceRequest(
      this.webSocketFactory,
      createLocalServiceUrl(this.options.host, this.options.port),
      { type: 'health-check' },
      this.healthTimeoutMs
    )

    if (response.type !== 'health-status') {
      return {
        ok: false,
        runtimeFamilyId: this.options.runtimeFamilyId,
        modelIdentifier: this.options.modelIdentifier,
        readiness: 'prewarm-required',
        detail: {
          reason: 'unexpected-response',
          responseType: response.type
        }
      }
    }

    return {
      ok: response.ok,
      runtimeFamilyId: response.runtimeFamilyId,
      modelIdentifier: response.modelIdentifier,
      readiness: response.readiness,
      ...(response.detail ? { detail: response.detail } : {})
    }
  }

  async prewarm(
    target: ResolvedLocalServiceConfig,
    input: {
      mode: SessionMode
      language: string
    }
  ): Promise<LocalServiceHealthResult> {
    const response = await sendLocalServiceRequest(
      this.webSocketFactory,
      createLocalServiceUrl(this.options.host, this.options.port),
      {
        type: 'prewarm',
        mode: input.mode,
        language: input.language
      },
      this.healthTimeoutMs
    )

    if (response.type === 'prewarm-complete') {
      return this.healthCheck(target)
    }

    if (response.type !== 'health-status') {
      return {
        ok: false,
        runtimeFamilyId: this.options.runtimeFamilyId,
        modelIdentifier: this.options.modelIdentifier,
        readiness: 'prewarm-required',
        detail: {
          reason: 'unexpected-response',
          responseType: response.type
        }
      }
    }

    return {
      ok: response.ok,
      runtimeFamilyId: response.runtimeFamilyId,
      modelIdentifier: response.modelIdentifier,
      readiness: response.readiness,
      ...(response.detail ? { detail: response.detail } : {})
    }
  }
}

class InvalidLocalServiceController implements LocalServiceController {
  constructor(private readonly error: AppErrorPayload) {}

  async start(_target: ResolvedLocalServiceConfig): Promise<void> {
    throw this.error
  }

  async stop(): Promise<void> {}

  async healthCheck(_target: ResolvedLocalServiceConfig): Promise<LocalServiceHealthResult> {
    return {
      ok: false,
      runtimeFamilyId: 'sensevoice',
      modelIdentifier: 'unavailable',
      readiness: 'prewarm-required',
      detail: {
        code: this.error.code,
        message: this.error.message,
        ...(this.error.detail ? { detail: this.error.detail } : {})
      }
    }
  }

  async prewarm(
    _target: ResolvedLocalServiceConfig,
    _input: {
      mode: SessionMode
      language: string
    }
  ): Promise<LocalServiceHealthResult> {
    throw this.error
  }
}

export function resolveLocalServiceControllerConfig(
  target: ResolvedLocalServiceConfig,
  managedRuntimePaths: ManagedRuntimePaths
): LocalServiceControllerConfig {
  if (target.mode === 'remote-service') {
    return {
      mode: 'remote-service',
      host: target.host,
      port: target.port,
      runtimeFamilyId: target.runtimeFamilyId,
      modelIdentifier: target.modelIdentifier
    }
  }

  const servicePath = managedRuntimePaths[target.runtimeFamilyId as keyof ManagedRuntimePaths]

  if (!servicePath) {
    return {
      mode: 'invalid',
      error: {
        code: 'E_ENGINE_UNAVAILABLE',
        message: `No managed-local service project is configured for runtime "${target.runtimeFamilyId}"`,
        retryable: false,
        detail: {
          runtimeFamilyId: target.runtimeFamilyId,
          recommendedMode: 'remote-service'
        }
      }
    }
  }

  return {
    ...target,
    servicePath
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled local service controller config: ${JSON.stringify(value)}`)
}
