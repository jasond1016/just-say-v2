import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { WindowsHotkeyHelperSource } from './windows-hotkey-helper'

describe('WindowsHotkeyHelperSource', () => {
  it('waits for a ready message and forwards hotkey events', async () => {
    const child = createFakeHelperProcess()
    const spawn = vi.fn(() => child)
    const source = new WindowsHotkeyHelperSource({
      helperPath: 'C:\\helper\\JustSayHotkeyHelper.exe',
      existsSync: () => true,
      spawn,
      startTimeoutMs: 50
    })
    const events: Array<{ hotkey: string; state: string }> = []

    const startPromise = source.start((event) => {
      events.push(event)
    })

    child.stdout.emit('data', Buffer.from('{"type":"ready"}\n', 'utf8'))
    await startPromise
    child.stdout.emit(
      'data',
      Buffer.from(
        '{"type":"hotkey","hotkey":"RCtrl","state":"DOWN"}\n{"type":"hotkey","hotkey":"RCtrl","state":"UP"}\n',
        'utf8'
      )
    )

    expect(spawn).toHaveBeenCalledWith(
      'C:\\helper\\JustSayHotkeyHelper.exe',
      [],
      expect.objectContaining({
        cwd: 'C:\\helper',
        windowsHide: true
      })
    )
    expect(events).toEqual([
      { type: 'hotkey', hotkey: 'RCtrl', state: 'DOWN' },
      { type: 'hotkey', hotkey: 'RCtrl', state: 'UP' }
    ])
  })

  it('fails fast when the helper exits before readiness', async () => {
    const child = createFakeHelperProcess()
    const source = new WindowsHotkeyHelperSource({
      helperPath: 'C:\\helper\\JustSayHotkeyHelper.exe',
      existsSync: () => true,
      spawn: vi.fn(() => child),
      startTimeoutMs: 50
    })

    const startPromise = source.start(() => {})
    child.stderr.emit('data', Buffer.from('helper failed to initialize', 'utf8'))
    child.emit('exit', 1, null)

    await expect(startPromise).rejects.toThrow('helper failed to initialize')
  })

  it('kills the helper process on stop', async () => {
    const child = createFakeHelperProcess()
    const source = new WindowsHotkeyHelperSource({
      helperPath: 'C:\\helper\\JustSayHotkeyHelper.exe',
      existsSync: () => true,
      spawn: vi.fn(() => child),
      startTimeoutMs: 50
    })

    const startPromise = source.start(() => {})
    child.stdout.emit('data', Buffer.from('{"type":"ready"}\n', 'utf8'))
    await startPromise
    source.stop()

    expect(child.kill).toHaveBeenCalledTimes(1)
  })
})

function createFakeHelperProcess() {
  const processEmitter = new EventEmitter()
  const stdout = new EventEmitter()
  const stderr = new EventEmitter()

  return {
    killed: false,
    stdout,
    stderr,
    once: processEmitter.once.bind(processEmitter),
    emit: processEmitter.emit.bind(processEmitter),
    kill: vi.fn(() => true)
  }
}
