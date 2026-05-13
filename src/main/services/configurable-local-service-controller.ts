import path from 'node:path'
import type { AppErrorPayload, AppSettings } from '../../shared/api-types'
import type { WebSocketLike } from './python-local-service-controller'
import {
  createLocalServiceUrl,
  defaultWebSocketFactory,
  PythonLocalServiceController,
  sendLocalServiceRequest
} from './python-local-service-controller'
import type { LocalServiceController, LocalServiceHealthResult } from './local-service-supervisor'

const DEFAULT_LOCAL_SERVICE_HOST = '127.0.0.1'
const DEFAULT_LOCAL_SERVICE_PORT = 8765

type ManagedLocalServiceConfig = {
  mode: 'managed-local'
  host: string
  port: number
}

type RemoteLocalServiceConfig = {
  mode: 'remote-service'
  host: string
  port: number
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
  getSettings: () => AppSettings
  localServicePath: string
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

  async start(): Promise<void> {
    const controller = await this.resolveController()
    await controller.start()
  }

  async stop(): Promise<void> {
    if (!this.activeController) {
      return
    }

    await this.activeController.stop()
    this.activeController = null
    this.activeSignature = null
  }

  async healthCheck(): Promise<LocalServiceHealthResult> {
    const controller = await this.resolveController()
    return controller.healthCheck()
  }

  private async resolveController(): Promise<LocalServiceController> {
    const config = resolveLocalServiceControllerConfig(this.options.getSettings())
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
      scriptPath: path.join(this.options.localServicePath, 'service.py'),
      workingDirectory: this.options.localServicePath,
      healthTimeoutMs: this.healthTimeoutMs,
      webSocketFactory: this.webSocketFactory
    })
  }

  private createDefaultRemoteController(config: RemoteLocalServiceConfig): LocalServiceController {
    return new RemoteLocalServiceController({
      host: config.host,
      port: config.port,
      healthTimeoutMs: this.healthTimeoutMs,
      webSocketFactory: this.webSocketFactory
    })
  }
}

export class RemoteLocalServiceController implements LocalServiceController {
  private readonly healthTimeoutMs: number
  private readonly webSocketFactory: (url: string) => WebSocketLike

  constructor(
    private readonly options: {
      host: string
      port: number
      healthTimeoutMs?: number
      webSocketFactory?: (url: string) => WebSocketLike
    }
  ) {
    this.healthTimeoutMs = options.healthTimeoutMs ?? 10_000
    this.webSocketFactory = options.webSocketFactory ?? defaultWebSocketFactory
  }

  async start(): Promise<void> {}

  async stop(): Promise<void> {}

  async healthCheck(): Promise<LocalServiceHealthResult> {
    const response = await sendLocalServiceRequest(
      this.webSocketFactory,
      createLocalServiceUrl(this.options.host, this.options.port),
      { type: 'health-check' },
      this.healthTimeoutMs
    )

    if (response.type !== 'health-status') {
      return {
        ok: false,
        detail: {
          reason: 'unexpected-response',
          responseType: response.type
        }
      }
    }

    return {
      ok: response.ok,
      ...(response.detail ? { detail: response.detail } : {})
    }
  }
}

class InvalidLocalServiceController implements LocalServiceController {
  constructor(private readonly error: AppErrorPayload) {}

  async start(): Promise<void> {
    throw this.error
  }

  async stop(): Promise<void> {}

  async healthCheck(): Promise<LocalServiceHealthResult> {
    return {
      ok: false,
      detail: {
        code: this.error.code,
        message: this.error.message,
        ...(this.error.detail ? { detail: this.error.detail } : {})
      }
    }
  }
}

export function resolveLocalServiceControllerConfig(settings: AppSettings): LocalServiceControllerConfig {
  if (settings.advanced.localServiceMode === 'remote-service') {
    const host = settings.advanced.remoteServiceHost?.trim()

    if (!host) {
      return {
        mode: 'invalid',
        error: {
          code: 'E_INVALID_SETTINGS',
          message: 'Remote speech service host is required when remote service mode is enabled',
          retryable: false,
          detail: {
            localServiceMode: settings.advanced.localServiceMode,
            missingField: 'advanced.remoteServiceHost'
          }
        }
      }
    }

    return {
      mode: settings.advanced.localServiceMode,
      host,
      port: settings.advanced.remoteServicePort ?? DEFAULT_LOCAL_SERVICE_PORT
    }
  }

  return {
    mode: settings.advanced.localServiceMode,
    host: settings.advanced.localServiceHost ?? DEFAULT_LOCAL_SERVICE_HOST,
    port: settings.advanced.localServicePort ?? DEFAULT_LOCAL_SERVICE_PORT
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled local service controller config: ${JSON.stringify(value)}`)
}
