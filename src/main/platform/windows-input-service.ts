import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'
import type { ClipboardOutputTarget, InputOutputTarget } from '../services/output-dispatcher'

const execFile = promisify(execFileCallback)
const PASTE_COMMAND = "Add-Type -AssemblyName System.Windows.Forms; Start-Sleep -Milliseconds 40; [System.Windows.Forms.SendKeys]::SendWait('^v')"

export type WindowsInputServiceOptions = {
  platform?: NodeJS.Platform
  shellPath?: string
  execFile?: (
    file: string,
    args: string[],
    options: {
      windowsHide: boolean
    }
  ) => Promise<unknown>
}

export class WindowsInputService implements InputOutputTarget {
  private readonly platform: NodeJS.Platform
  private readonly shellPath: string
  private readonly execFile: NonNullable<WindowsInputServiceOptions['execFile']>

  constructor(
    private readonly clipboard: ClipboardOutputTarget,
    options: WindowsInputServiceOptions = {}
  ) {
    this.platform = options.platform ?? process.platform
    this.shellPath = options.shellPath ?? 'powershell.exe'
    this.execFile = options.execFile ?? execFile
  }

  async sendText(text: string): Promise<void> {
    if (this.platform !== 'win32') {
      throw new Error('Simulated input is only supported on Windows')
    }

    await this.clipboard.writeText(text)
    await this.execFile(this.shellPath, ['-NoProfile', '-NonInteractive', '-Command', PASTE_COMMAND], {
      windowsHide: true
    })
  }
}
