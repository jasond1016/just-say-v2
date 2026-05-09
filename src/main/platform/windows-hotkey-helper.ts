import { existsSync } from 'node:fs'
import { spawn as spawnChildProcess } from 'node:child_process'
import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from 'node:child_process'
import path from 'node:path'
import type { HotkeyEvent, HotkeyEventSource } from './hotkey-service'

type WindowsHotkeyHelperOptions = {
  helperPath: string
  spawn?: SpawnWindowsHotkeyHelper
  existsSync?: (path: string) => boolean
  startTimeoutMs?: number
}

type HotkeyHelperMessage =
  | {
      type: 'ready'
    }
  | {
      type: 'hotkey'
      hotkey: HotkeyEvent['hotkey']
      state: HotkeyEvent['state']
    }

interface HotkeyHelperReadable {
  on(event: 'data', listener: (chunk: string | Buffer) => void): void
}

export interface SpawnedWindowsHotkeyHelperProcess {
  killed: boolean
  stdout: HotkeyHelperReadable
  stderr: HotkeyHelperReadable
  once(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): void
  once(event: 'error', listener: (error: Error) => void): void
  kill(): boolean
}

export type SpawnWindowsHotkeyHelper = (
  command: string,
  args: string[],
  options: SpawnOptionsWithoutStdio
) => SpawnedWindowsHotkeyHelperProcess

export class WindowsHotkeyHelperSource implements HotkeyEventSource {
  private readonly spawn: SpawnWindowsHotkeyHelper
  private readonly existsSync: (path: string) => boolean
  private readonly startTimeoutMs: number
  private childProcess: SpawnedWindowsHotkeyHelperProcess | null = null
  private stdoutBuffer = ''
  private stderrBuffer = ''

  constructor(private readonly options: WindowsHotkeyHelperOptions) {
    this.spawn = options.spawn ?? defaultSpawnWindowsHotkeyHelper
    this.existsSync = options.existsSync ?? existsSync
    this.startTimeoutMs = options.startTimeoutMs ?? 5_000
  }

  async start(onEvent: (event: HotkeyEvent) => void): Promise<void> {
    if (this.childProcess && !this.childProcess.killed) {
      return
    }

    if (!this.existsSync(this.options.helperPath)) {
      throw new Error(`Windows hotkey helper not found at ${this.options.helperPath}`)
    }

    const child = this.spawn(this.options.helperPath, [], {
      cwd: path.dirname(this.options.helperPath),
      stdio: 'pipe',
      windowsHide: true
    })
    this.childProcess = child
    this.stdoutBuffer = ''
    this.stderrBuffer = ''

    await new Promise<void>((resolve, reject) => {
      let ready = false
      const timeout = setTimeout(() => {
        this.childProcess = null
        child.kill()
        reject(new Error('Timed out waiting for Windows hotkey helper to become ready'))
      }, this.startTimeoutMs)

      const settle = (callback: () => void) => {
        clearTimeout(timeout)
        callback()
      }

      child.stdout.on('data', (chunk) => {
        this.stdoutBuffer += chunk.toString()

        for (const line of drainLines(() => this.stdoutBuffer, (value) => {
          this.stdoutBuffer = value
        })) {
          const message = parseHelperMessage(line)

          if (!message) {
            continue
          }

          if (message.type === 'ready') {
            ready = true
            settle(resolve)
            continue
          }

          onEvent(message)
        }
      })

      child.stderr.on('data', (chunk) => {
        this.stderrBuffer = appendOutput(this.stderrBuffer, chunk.toString())
      })

      child.once('error', (error) => {
        this.childProcess = null

        if (!ready) {
          settle(() => reject(error))
        }
      })

      child.once('exit', (code, signal) => {
        this.childProcess = null

        if (ready) {
          return
        }

        settle(() => {
          reject(
            new Error(
              this.stderrBuffer ||
                `Windows hotkey helper exited before readiness (code=${String(code)}, signal=${String(signal)})`
            )
          )
        })
      })
    })
  }

  stop(): void {
    if (!this.childProcess) {
      this.stdoutBuffer = ''
      this.stderrBuffer = ''
      return
    }

    this.childProcess.kill()
    this.childProcess = null
    this.stdoutBuffer = ''
    this.stderrBuffer = ''
  }

  isRunning(): boolean {
    return this.childProcess !== null && !this.childProcess.killed
  }
}

function defaultSpawnWindowsHotkeyHelper(
  command: string,
  args: string[],
  options: SpawnOptionsWithoutStdio
): SpawnedWindowsHotkeyHelperProcess {
  return spawnChildProcess(command, args, options) as ChildProcessWithoutNullStreams
}

function parseHelperMessage(line: string): HotkeyHelperMessage | null {
  const trimmed = line.trim()

  if (!trimmed) {
    return null
  }

  let message: unknown

  try {
    message = JSON.parse(trimmed)
  } catch {
    return null
  }

  if (!isHelperMessage(message)) {
    return null
  }

  return message
}

function isHelperMessage(message: unknown): message is HotkeyHelperMessage {
  if (!message || typeof message !== 'object' || !('type' in message)) {
    return false
  }

  if (message.type === 'ready') {
    return true
  }

  if (message.type !== 'hotkey' || !('hotkey' in message) || !('state' in message)) {
    return false
  }

  return (
    (message.hotkey === 'RCtrl' || message.hotkey === 'RAlt') &&
    (message.state === 'DOWN' || message.state === 'UP')
  )
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

function appendOutput(existing: string, next: string): string {
  return `${existing}${next}`.slice(-4_000)
}
