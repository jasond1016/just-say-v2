import { spawn as spawnChildProcess } from 'node:child_process'
import { access } from 'node:fs/promises'
import path from 'node:path'
import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from 'node:child_process'
import type { ResolvedLocalServiceConfig } from '../../shared/api-types'
import type { SessionMode } from '../../shared/primitive-types'
import type {
  LocalServiceController,
  LocalServiceHealthResult
} from './local-service-supervisor'
import { terminateWindowsProcessTree } from './python-local-service-controller'

interface NativeServiceReadable {
  on(event: 'data', listener: (chunk: string | Buffer) => void): void
}

export interface SpawnedNativeServiceProcess {
  killed: boolean
  pid: number | undefined
  stdout: NativeServiceReadable
  stderr: NativeServiceReadable
  once(event: 'exit', listener: () => void): void
  kill(): boolean
}

export type SpawnNativeServiceProcess = (
  command: string,
  args: string[],
  options: SpawnOptionsWithoutStdio
) => SpawnedNativeServiceProcess

type NativeFetchResponse = {
  ok: boolean
  json(): Promise<unknown>
}

export type NativeServiceFetch = (
  url: string,
  init?: { signal?: AbortSignal }
) => Promise<NativeFetchResponse>

export type NativeSenseVoiceServiceControllerOptions = {
  host: string
  port: number
  modelIdentifier: string
  servicePath: string
  binaryPath?: string
  modelPath?: string
  vadModelPath?: string
  gpuLayers?: number
  threads?: number
  partialMs?: number
  vadMaxSegmentMs?: number
  vadSlotMs?: number
  healthTimeoutMs?: number
  spawn?: SpawnNativeServiceProcess
  fetch?: NativeServiceFetch
  fileExists?: (filePath: string) => Promise<boolean>
  terminateProcessTree?: (pid: number) => Promise<void>
}

export class NativeSenseVoiceServiceController implements LocalServiceController {
  private readonly binaryPath: string
  private readonly modelPath: string
  private readonly vadModelPath: string
  private readonly healthTimeoutMs: number
  private readonly spawn: SpawnNativeServiceProcess
  private readonly fetch: NativeServiceFetch
  private readonly fileExists: (filePath: string) => Promise<boolean>
  private readonly terminateProcessTree: ((pid: number) => Promise<void>) | undefined
  private childProcess: SpawnedNativeServiceProcess | null = null

  constructor(private readonly options: NativeSenseVoiceServiceControllerOptions) {
    this.binaryPath =
      options.binaryPath ??
      process.env.JUSTSAY_SENSEVOICE_SERVER_BINARY ??
      path.join(
        options.servicePath,
        'bin',
        process.platform === 'win32' ? 'sensevoice-server.exe' : 'sensevoice-server'
      )
    this.modelPath =
      options.modelPath ??
      process.env.JUSTSAY_SENSEVOICE_MODEL_PATH ??
      path.join(options.servicePath, 'models', 'sensevoice-small-q8.gguf')
    this.vadModelPath =
      options.vadModelPath ??
      process.env.JUSTSAY_SENSEVOICE_VAD_PATH ??
      path.join(options.servicePath, 'models', 'fsmn-vad.gguf')
    this.healthTimeoutMs = options.healthTimeoutMs ?? 60_000
    this.spawn = options.spawn ?? defaultSpawnNativeServiceProcess
    this.fetch = options.fetch ?? defaultNativeServiceFetch
    this.fileExists = options.fileExists ?? defaultFileExists
    this.terminateProcessTree =
      options.terminateProcessTree ??
      (process.platform === 'win32' ? terminateWindowsProcessTree : undefined)
  }

  async start(_target: ResolvedLocalServiceConfig): Promise<void> {
    if (this.childProcess && !this.childProcess.killed) {
      return
    }

    await this.assertRuntimeFilesExist()
    const child = this.spawn(this.binaryPath, this.createArguments(), {
      cwd: this.options.servicePath,
      env: process.env,
      stdio: 'pipe',
      windowsHide: true
    })
    this.childProcess = child
    this.attachLogging(child)
    child.once('exit', () => {
      if (this.childProcess === child) {
        this.childProcess = null
      }
    })

    try {
      await this.waitForHealth()
    } catch (error) {
      await this.stopChildProcess(child)
      throw error
    }
  }

  async stop(): Promise<void> {
    if (this.childProcess) {
      await this.stopChildProcess(this.childProcess)
    }
  }

  async healthCheck(target: ResolvedLocalServiceConfig): Promise<LocalServiceHealthResult> {
    const healthResponse = await this.fetch(`${this.getHttpBaseUrl()}/health`, {
      signal: AbortSignal.timeout(this.healthTimeoutMs)
    })
    if (!healthResponse.ok) {
      return this.unhealthyResult(target, 'Native SenseVoice health endpoint failed')
    }

    const modelsResponse = await this.fetch(`${this.getHttpBaseUrl()}/v1/models`, {
      signal: AbortSignal.timeout(this.healthTimeoutMs)
    })
    if (!modelsResponse.ok || !(await responseContainsSenseVoiceModel(modelsResponse))) {
      return this.unhealthyResult(target, 'Native SenseVoice model identity check failed')
    }

    return {
      ok: true,
      runtimeFamilyId: target.runtimeFamilyId,
      modelIdentifier: target.modelIdentifier,
      readiness: 'ready'
    }
  }

  async prewarm(
    target: ResolvedLocalServiceConfig,
    _input: { mode: SessionMode; language: string }
  ): Promise<LocalServiceHealthResult> {
    return this.healthCheck(target)
  }

  private createArguments(): string[] {
    return [
      '-m',
      this.modelPath,
      '-vad',
      this.vadModelPath,
      '-ngl',
      String(this.options.gpuLayers ?? readIntegerEnvironment('JUSTSAY_SENSEVOICE_GPU_LAYERS', 1)),
      '--threads',
      String(this.options.threads ?? readIntegerEnvironment('JUSTSAY_SENSEVOICE_THREADS', 8)),
      '--partial-ms',
      String(this.options.partialMs ?? readIntegerEnvironment('JUSTSAY_SENSEVOICE_PARTIAL_MS', 400)),
      '--vad-maxseg',
      String(
        this.options.vadMaxSegmentMs ??
          readIntegerEnvironment('JUSTSAY_SENSEVOICE_VAD_MAXSEG_MS', 30_000)
      ),
      '--vad-slot-ms',
      String(
        this.options.vadSlotMs ??
          readIntegerEnvironment('JUSTSAY_SENSEVOICE_VAD_SLOT_MS', 2_000)
      ),
      this.options.host,
      String(this.options.port)
    ]
  }

  private async assertRuntimeFilesExist(): Promise<void> {
    for (const [kind, filePath] of [
      ['binary', this.binaryPath],
      ['SenseVoice model', this.modelPath],
      ['FSMN-VAD model', this.vadModelPath]
    ] as const) {
      if (!(await this.fileExists(filePath))) {
        throw new Error(
          `Native SenseVoice ${kind} is missing at ${filePath}. Run "pnpm setup:native-sensevoice" first.`
        )
      }
    }
  }

  private async waitForHealth(): Promise<void> {
    const startedAt = Date.now()
    let lastError: unknown = null
    const target: ResolvedLocalServiceConfig = {
      mode: 'managed-local',
      host: this.options.host,
      port: this.options.port,
      runtimeFamilyId: 'sensevoice',
      modelIdentifier: this.options.modelIdentifier,
      protocol: 'openai-realtime'
    }

    while (Date.now() - startedAt < this.healthTimeoutMs) {
      try {
        const health = await this.healthCheck(target)
        if (health.ok) {
          return
        }
        lastError = new Error(String(health.detail?.message ?? 'Native SenseVoice is unhealthy'))
      } catch (error) {
        lastError = error
      }
      await delay(200)
    }

    throw new Error(
      lastError instanceof Error ? lastError.message : 'Native SenseVoice failed to start'
    )
  }

  private unhealthyResult(
    target: ResolvedLocalServiceConfig,
    message: string
  ): LocalServiceHealthResult {
    return {
      ok: false,
      runtimeFamilyId: target.runtimeFamilyId,
      modelIdentifier: target.modelIdentifier,
      readiness: 'prewarm-required',
      detail: { message }
    }
  }

  private getHttpBaseUrl(): string {
    return `http://${this.options.host}:${this.options.port}`
  }

  private attachLogging(child: SpawnedNativeServiceProcess): void {
    child.stdout.on('data', (chunk) => {
      const message = chunk.toString().trim()
      if (message) {
        console.log(`[native-sensevoice] ${message}`)
      }
    })
    child.stderr.on('data', (chunk) => {
      const message = chunk.toString().trim()
      if (message) {
        console.error(`[native-sensevoice] ${message}`)
      }
    })
  }

  private async stopChildProcess(child: SpawnedNativeServiceProcess): Promise<void> {
    const waitForExit = new Promise<void>((resolve) => {
      child.once('exit', resolve)
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

function defaultSpawnNativeServiceProcess(
  command: string,
  args: string[],
  options: SpawnOptionsWithoutStdio
): SpawnedNativeServiceProcess {
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

async function defaultNativeServiceFetch(
  url: string,
  init?: { signal?: AbortSignal }
): Promise<NativeFetchResponse> {
  return fetch(url, init)
}

async function defaultFileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

async function responseContainsSenseVoiceModel(response: NativeFetchResponse): Promise<boolean> {
  const body = await response.json()
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return false
  }
  const data = (body as Record<string, unknown>).data
  if (!Array.isArray(data)) {
    return false
  }
  return data.some((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return false
    }
    return (entry as Record<string, unknown>).id === 'sensevoice-small'
  })
}

function readIntegerEnvironment(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined) {
    return fallback
  }
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

function delay(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, timeoutMs)
  })
}
