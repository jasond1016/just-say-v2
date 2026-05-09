import { spawn as spawnChildProcess } from 'node:child_process'
import { execFile as execFileCallback } from 'node:child_process'
import path from 'node:path'
import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from 'node:child_process'
import { promisify } from 'node:util'
import type { EngineCapabilities } from '../../shared/api-types'
import type { LocalServiceHealthResult, LocalServiceController } from './local-service-supervisor'
import type {
  LocalServiceClientMessage,
  LocalServiceServerMessage
} from '../../shared/local-service-types'

const execFile = promisify(execFileCallback)

export interface WebSocketLike {
  addEventListener(type: 'message', listener: (event: { data: string }) => void): void
  addEventListener(type: 'error', listener: (event: unknown) => void): void
  addEventListener(type: 'open', listener: () => void): void
  addEventListener(type: 'close', listener: () => void): void
  send(data: string): void
  close(): void
}

interface LocalServiceReadable {
  on(event: 'data', listener: (chunk: string | Buffer) => void): void
}

export interface SpawnedLocalServiceProcess {
  killed: boolean
  pid: number | undefined
  stdout: LocalServiceReadable
  stderr: LocalServiceReadable
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
  terminateProcessTree?: (pid: number) => Promise<void>
  webSocketFactory?: (url: string) => WebSocketLike
}

export class PythonLocalServiceController implements LocalServiceController {
  private readonly modelName: string
  private readonly runnerCommand: string
  private readonly runnerArgs: string[]
  private readonly healthTimeoutMs: number
  private readonly spawn: SpawnLocalServiceProcess
  private readonly terminateProcessTree: ((pid: number) => Promise<void>) | undefined
  private readonly webSocketFactory: (url: string) => WebSocketLike
  private childProcess: SpawnedLocalServiceProcess | null = null
  private stdoutBuffer = ''
  private stderrBuffer = ''

  constructor(private readonly options: PythonLocalServiceControllerOptions) {
    this.modelName = options.modelName ?? 'iic/SenseVoiceSmall'
    this.runnerCommand = options.runnerCommand ?? 'uv'
    this.runnerArgs = options.runnerArgs ?? []
    this.healthTimeoutMs = options.healthTimeoutMs ?? 10_000
    this.spawn = options.spawn ?? defaultSpawnLocalServiceProcess
    this.terminateProcessTree =
      options.terminateProcessTree ?? (process.platform === 'win32' ? terminateWindowsProcessTree : undefined)
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
        'python',
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
    this.attachChildLogging(child)

    try {
      await this.waitForHealth()
    } catch (error) {
      await this.stopChildProcess(child)
      throw error
    }
  }

  async stop(): Promise<void> {
    const child = this.childProcess

    if (!child) {
      return
    }

    await this.stopChildProcess(child)
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

  private attachChildLogging(child: SpawnedLocalServiceProcess): void {
    this.stdoutBuffer = ''
    this.stderrBuffer = ''

    child.stdout.on('data', (chunk) => {
      this.stdoutBuffer += chunk.toString()

      for (const line of drainLines(() => this.stdoutBuffer, (value) => {
        this.stdoutBuffer = value
      })) {
        const trimmed = line.trim()

        if (trimmed) {
          console.log(`[local-service] ${trimmed}`)
        }
      }
    })

    child.stderr.on('data', (chunk) => {
      this.stderrBuffer += chunk.toString()

      for (const line of drainLines(() => this.stderrBuffer, (value) => {
        this.stderrBuffer = value
      })) {
        const trimmed = line.trim()

        if (trimmed) {
          console.error(`[local-service] ${trimmed}`)
        }
      }
    })

    child.once('exit', () => {
      this.flushBufferedOutput()
    })
  }

  private flushBufferedOutput(): void {
    const stdout = this.stdoutBuffer.trim()
    const stderr = this.stderrBuffer.trim()

    if (stdout) {
      console.log(`[local-service] ${stdout}`)
    }

    if (stderr) {
      console.error(`[local-service] ${stderr}`)
    }

    this.stdoutBuffer = ''
    this.stderrBuffer = ''
  }

  private async stopChildProcess(child: SpawnedLocalServiceProcess): Promise<void> {
    const waitForExit = new Promise<void>((resolve) => {
      child.once('exit', () => resolve())
    })

    if (typeof child.pid === 'number' && this.terminateProcessTree) {
      try {
        await this.terminateProcessTree(child.pid)
      } catch {
        child.kill()
      }
    } else {
      child.kill()
    }

    await waitForExit

    if (this.childProcess === child) {
      this.childProcess = null
    }
  }
}

function defaultSpawnLocalServiceProcess(
  command: string,
  args: string[],
  options: SpawnOptionsWithoutStdio
): SpawnedLocalServiceProcess {
  const child = spawnChildProcess(command, args, options) as ChildProcessWithoutNullStreams

  return {
    get killed() {
      return child.killed
    },
    get pid() {
      return child.pid
    },
    stdout: child.stdout,
    stderr: child.stderr,
    once(event, listener) {
      child.once(event, listener)
    },
    kill() {
      return child.kill()
    }
  }
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

export async function terminateWindowsProcessTree(pid: number): Promise<void> {
  await execFile('taskkill', ['/PID', String(pid), '/T', '/F'], {
    windowsHide: true
  })
}

function delay(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, timeoutMs)
  })
}

function drainLines(
  getBuffer: () => string,
  setBuffer: (value: string) => void
): string[] {
  const lines: string[] = []
  let buffer = getBuffer()
  let newlineIndex = buffer.indexOf('\n')

  while (newlineIndex >= 0) {
    lines.push(buffer.slice(0, newlineIndex))
    buffer = buffer.slice(newlineIndex + 1)
    newlineIndex = buffer.indexOf('\n')
  }

  setBuffer(buffer)
  return lines
}
