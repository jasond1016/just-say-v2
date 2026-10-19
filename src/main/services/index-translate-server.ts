import { spawn as spawnChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from 'node:child_process'

import type { AppSettings } from '../../shared/api-types'
import {
  DEFAULT_INDEX_TRANSLATE_HOST,
  DEFAULT_INDEX_TRANSLATE_PORT,
  indexTranslateClientEndpoint
} from '../../core/settings/settings-resolver'
import { terminateWindowsProcessTree } from './python-local-service-controller'

export type IndexTranslateLaunch = {
  serverPath: string
  modelPath: string
  bindHost: string
  port: number
  endpoint: string
}

export type SpawnedIndexTranslateProcess = {
  killed: boolean
  pid: number | undefined
  stdout: { on(event: 'data', listener: (chunk: string | Buffer) => void): void }
  stderr: { on(event: 'data', listener: (chunk: string | Buffer) => void): void }
  once(event: 'exit', listener: (code: number | null) => void): void
  kill(): boolean
}

export type SpawnIndexTranslateProcess = (
  command: string,
  args: string[],
  options: SpawnOptionsWithoutStdio
) => SpawnedIndexTranslateProcess

export function resolveIndexTranslateLaunch(
  appRoot: string,
  env: NodeJS.ProcessEnv = process.env,
  exists: (filePath: string) => boolean = existsSync
): IndexTranslateLaunch | undefined {
  const port = readPort(env.JUSTSAY_INDEX_TRANSLATE_PORT) ?? DEFAULT_INDEX_TRANSLATE_PORT
  const modelPath =
    env.JUSTSAY_INDEX_TRANSLATE_MODEL?.trim() ||
    path.join(appRoot, '.amp', 'in', 'mt', 'index-translate-2b', 'models', 'Index-Translate-2B.Q4_K_M.gguf')
  const serverPath =
    env.JUSTSAY_INDEX_TRANSLATE_SERVER?.trim() ||
    path.join(appRoot, '.amp', 'in', 'mt', 'index-translate-2b', 'bin', 'llama', 'llama-server.exe')

  if (!exists(modelPath) || !exists(serverPath)) {
    return undefined
  }

  return {
    serverPath,
    modelPath,
    bindHost: DEFAULT_INDEX_TRANSLATE_HOST,
    port,
    endpoint: indexTranslateClientEndpoint(DEFAULT_INDEX_TRANSLATE_HOST, port)
  }
}

export function shouldRunIndexTranslate(settings: AppSettings): boolean {
  return (
    settings.translation.provider === 'index-translate' &&
    settings.translation.deployment !== 'remote-service' &&
    (settings.translation.enabledForPtt || settings.translation.enabledForMeeting)
  )
}

export type IndexTranslateServerOptions = {
  launch: IndexTranslateLaunch
  spawn?: SpawnIndexTranslateProcess
  fetchFn?: typeof fetch
  terminateProcessTree?: (pid: number) => Promise<void>
  healthTimeoutMs?: number
  pollIntervalMs?: number
}

export class IndexTranslateServer {
  private child: SpawnedIndexTranslateProcess | null = null
  private owned = false
  private activeBind: { host: string; port: number } | null = null
  private exited: Promise<number | null> | null = null
  private readonly spawn: SpawnIndexTranslateProcess
  private readonly fetchFn: typeof fetch
  private readonly terminateProcessTree: ((pid: number) => Promise<void>) | undefined
  private readonly healthTimeoutMs: number
  private readonly pollIntervalMs: number

  constructor(private readonly options: IndexTranslateServerOptions) {
    this.spawn = options.spawn ?? defaultSpawnIndexTranslateProcess
    this.fetchFn = options.fetchFn ?? fetch
    this.terminateProcessTree =
      options.terminateProcessTree ?? (process.platform === 'win32' ? terminateWindowsProcessTree : undefined)
    this.healthTimeoutMs = options.healthTimeoutMs ?? 60_000
    this.pollIntervalMs = options.pollIntervalMs ?? 250
  }

  async align(bind: { host: string; port: number }): Promise<void> {
    const sameBind = this.activeBind?.host === bind.host && this.activeBind?.port === bind.port

    if (sameBind && (this.owned || await this.isHealthy())) {
      return
    }

    if (this.owned) {
      await this.stop()
    }

    this.options.launch = {
      ...this.options.launch,
      bindHost: bind.host,
      port: bind.port,
      endpoint: indexTranslateClientEndpoint(bind.host, bind.port)
    }
    await this.start()
    this.activeBind = { ...bind }
  }

  async start(): Promise<void> {
    if (await this.isHealthy()) {
      return
    }

    if (this.child && !this.child.killed) {
      await this.waitUntilHealthy()
      return
    }

    const serverDir = path.dirname(this.options.launch.serverPath)
    const child = this.spawn(
      this.options.launch.serverPath,
      [
        '-m',
        this.options.launch.modelPath,
        '-c',
        '4096',
        '-ngl',
        '99',
        '--host',
        this.options.launch.bindHost,
        '--port',
        String(this.options.launch.port),
        '--reasoning',
        'off',
        '-fa',
        'on'
      ],
      {
        cwd: serverDir,
        env: {
          ...process.env,
          PATH: `${serverDir}${path.delimiter}${process.env.PATH ?? ''}`
        },
        stdio: 'pipe',
        windowsHide: true
      }
    )
    this.child = child
    this.owned = true
    this.exited = new Promise((resolve) => {
      child.once('exit', (code) => resolve(code))
    })
    attachLogs(child)

    try {
      await this.waitUntilHealthy()
    } catch (error) {
      await this.stop()
      throw error
    }
  }

  async stop(): Promise<void> {
    const child = this.child
    this.child = null

    if (!this.owned || !child) {
      this.owned = false
      this.exited = null
      return
    }

    this.owned = false
    this.activeBind = null
    const exited = this.exited ?? Promise.resolve(null)
    this.exited = null

    if (typeof child.pid === 'number' && this.terminateProcessTree) {
      try {
        await this.terminateProcessTree(child.pid)
      } catch {
        child.kill()
      }
    } else {
      child.kill()
    }

    await exited
  }

  private async isHealthy(): Promise<boolean> {
    try {
      const response = await this.fetchFn(`${this.options.launch.endpoint}/models`, {
        signal: AbortSignal.timeout(2_000)
      })
      return response.ok
    } catch {
      return false
    }
  }

  private async waitUntilHealthy(): Promise<void> {
    const deadline = Date.now() + this.healthTimeoutMs
    let exitCode: number | null | undefined

    if (this.exited) {
      void this.exited.then((code) => {
        exitCode = code
      })
    }

    while (Date.now() < deadline) {
      if (exitCode !== undefined) {
        throw new Error(`Index-Translate-2B server exited before it was ready (${String(exitCode)})`)
      }

      if (await this.isHealthy()) {
        return
      }

      await delay(this.pollIntervalMs)
    }

    throw new Error('Index-Translate-2B server did not become ready')
  }
}

function readPort(value: string | undefined): number | undefined {
  const trimmed = value?.trim()

  if (!trimmed) {
    return undefined
  }

  const port = Number.parseInt(trimmed, 10)

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return undefined
  }

  return port
}

function defaultSpawnIndexTranslateProcess(
  command: string,
  args: string[],
  options: SpawnOptionsWithoutStdio
): SpawnedIndexTranslateProcess {
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

function attachLogs(child: SpawnedIndexTranslateProcess): void {
  child.stdout.on('data', (chunk) => {
    const line = chunk.toString().trim()

    if (line) {
      console.log(`[index-translate] ${line}`)
    }
  })
  child.stderr.on('data', (chunk) => {
    const line = chunk.toString().trim()

    if (line) {
      console.error(`[index-translate] ${line}`)
    }
  })
}

function delay(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, timeoutMs)
  })
}
