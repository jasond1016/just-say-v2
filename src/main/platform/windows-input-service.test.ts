import { describe, expect, it, vi } from 'vitest'
import { WindowsInputService } from './windows-input-service'

describe('WindowsInputService', () => {
  it('writes text to the clipboard and sends a paste command to PowerShell', async () => {
    const clipboard = {
      writeText: vi.fn(async () => {})
    }
    const execFile = vi.fn(async () => ({}))
    const service = new WindowsInputService(clipboard, {
      platform: 'win32',
      shellPath: 'powershell.exe',
      execFile
    })

    await service.sendText('hello world')

    expect(clipboard.writeText).toHaveBeenCalledWith('hello world')
    expect(execFile).toHaveBeenCalledWith(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "Add-Type -AssemblyName System.Windows.Forms; Start-Sleep -Milliseconds 40; [System.Windows.Forms.SendKeys]::SendWait('^v')"
      ],
      {
        windowsHide: true
      }
    )
  })

  it('rejects simulate_input on unsupported platforms', async () => {
    const service = new WindowsInputService(
      {
        writeText: vi.fn(async () => {})
      },
      {
        platform: 'darwin',
        execFile: vi.fn(async () => ({}))
      }
    )

    await expect(service.sendText('hello')).rejects.toThrow('Simulated input is only supported on Windows')
  })
})
