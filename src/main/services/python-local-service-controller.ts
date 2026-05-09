import { spawn as spawnChildProcess } from 'node:child_process'
import path from 'node:path'
import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from 'node:child_process'
import type { EngineCapabilities } from '../../shared/api-types'
import type { LocalServiceHealthResult, LocalServiceController } from './local-service-supervisor'
import type {
  LocalServiceClientMessage,
  LocalServiceServerMessage
} from '../../shared/local-service-types'

export interface WebSocketLike {
  addEventListener(type: 'message', listener: (event: { data: string }) => void): void
  addEventListener(type: 'error', listener: (event: unknown) => void): void
  addEventListener(type: 'open', listener: () => void): void
  addEventListener(type: 'close', listener: () => void): void
  send(data: string): void
  close(): void
}

export interface SpawnedLocalServiceProcess {
  killed: boolean
  once(event: 'exit', listener: () => void): void
  kill(): boolean
}

export type SpawnLocalServiceProcess = (
  command: string,
  args: string[],
  options: SpawnOptionsWithoutStdio
) => SpawnedLocalServiceProcess

export type PythonLocalServiceControllerOptions = {
  host: string
  port: number
  modelName?: string
  runnerCommand?: string
  runnerArgs?: string[]
  scriptPath: string
  workingDirectory?: string
  env?: NodeJS.ProcessEnv
  healthTimeoutMs?: number
  spawn?: SpawnLocalServiceProcess
  webSocketFactory?: (url: string) => WebSocketLike
}

export class PythonLocalServiceController implements LocalServiceController {
  private readonly modelName: string
  private readonly runnerCommand: string
  private readonly runnerArgs: string[]
  private readonly healthTimeoutMs: number
  private readonly spawn: SpawnLocalServiceProcess
  private readonly webSocketFactory: (url: string) => WebSocketLike
  private childProcess: SpawnedLocalServiceProcess | null = null

  constructor(private readonly options: PythonLocalServiceControllerOptions) {
    this.modelName = options.modelName ?? 'iic/SenseVoiceSmall'
    this.runnerCommand = options.runnerCommand ?? 'uv'
    this.runnerArgs = options.runnerArgs ?? []
    this.healthTimeoutMs = options.healthTimeoutMs ?? 10_000
    this.spawn = options.spawn ?? defaultSpawnLocalServiceProcess
    this.webSocketFactory = options.webSocketFactory ?? defaultWebSocketFactory
  }

  async start(): Promise<void> {
    if (this.childProcess && !this.childProcess.killed) {
      return
    }

    const child = this.spawn(
      this.runnerCommand,
      [
        ...this.runnerArgs,
        'run',
        '--project',
        this.options.workingDirectory ?? path.dirname(this.options.scriptPath),
        this.options.scriptPath
      ],
      {
        cwd: this.options.workingDirectory ?? path.dirname(this.options.scriptPath),
        env: {
          ...process.env,
          ...this.options.env,
          JUSTSAY_LOCAL_SERVICE_HOST: this.options.host,
          JUSTSAY_LOCAL_SERVICE_PORT: String(this.options.port),
          JUSTSAY_LOCAL_SERVICE_MODEL: this.modelName
        },
        stdio: 'pipe',
        windowsHide: true
      }
    )

    this.childProcess = child

    await this.waitForHealth()
  }

  async stop(): Promise<void> {
    const child = this.childProcess

    if (!child) {
      return
    }

    await new Promise<void>((resolve) => {
      child.once('exit', () => resolve())
      child.kill()
    })
    this.childProcess = null
  }

  async healthCheck(): Promise<LocalServiceHealthResult> {
    const response = await sendLocalServiceRequest(
      this.webSocketFactory,
      this.getServiceUrl(),
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

  private async waitForHealth(): Promise<void> {
    const startedAt = Date.now()
    let lastError: unknown = null

    while (Date.now() - startedAt < this.healthTimeoutMs) {
      try {
        const health = await this.healthCheck()

        if (health.ok) {
          return
        }

        lastError = new Error('Local service reported unhealthy')
      } catch (error) {
        lastError = error
      }

      await delay(200)
    }

    throw new Error(lastError instanceof Error ? lastError.message : 'Local service failed to start')
  }

  private getServiceUrl(): string {
    return `ws://${this.options.host}:${this.options.port}`
  }
}

function defaultSpawnLocalServiceProcess(
  command: string,
  args: string[],
  options: SpawnOptionsWithoutStdio
): SpawnedLocalServiceProcess {
  return spawnChildProcess(command, args, options) as ChildProcessWithoutNullStreams
}

export function getDefaultLocalServiceCapabilities(): EngineCapabilities {
  return {
    streaming: true,
    translation: false,
    wordTiming: false,
    speakerSeparation: false,
    requiresNetwork: false,
    requiresLocalService: true
  }
}

async function sendLocalServiceRequest(
  webSocketFactory: (url: string) => WebSocketLike,
  url: string,
  message: LocalServiceClientMessage,
  timeoutMs: number
): Promise<LocalServiceServerMessage> {
  return new Promise<LocalServiceServerMessage>((resolve, reject) => {
    const socket = webSocketFactory(url)
    const timeout = setTimeout(() => {
      socket.close()
      reject(new Error('Timed out waiting for local service response'))
    }, timeoutMs)

    const settle = (callback: () => void) => {
      clearTimeout(timeout)
      socket.close()
      callback()
    }

    socket.addEventListener('open', () => {
      socket.send(JSON.stringify(message))
    })
    socket.addEventListener('message', (event) => {
      settle(() => resolve(JSON.parse(event.data) as LocalServiceServerMessage))
    })
    socket.addEventListener('error', (event) => {
      settle(() => reject(normalizeSocketError(event)))
    })
    socket.addEventListener('close', () => {
      // ignored; timeout/error path handles failures
    })
  })
}

function normalizeSocketError(errorLike: unknown): Error {
  if (errorLike instanceof Error) {
    return errorLike
  }

  return new Error('Local service websocket request failed')
}

function defaultWebSocketFactory(url: string): WebSocketLike {
  return new WebSocket(url) as unknown as WebSocketLike
}

function delay(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, timeoutMs)
  })
}
