import { describe, expect, it, vi } from 'vitest'
import { HotkeyService, type HotkeyEvent, type HotkeyEventSource } from './hotkey-service'

describe('HotkeyService', () => {
  it('triggers press and release callbacks for the configured PTT hotkey', async () => {
    const source = createFakeHotkeyEventSource()
    const service = createService(source)
    const onPressed = vi.fn()
    const onReleased = vi.fn()

    await service.setPttBinding({
      pttHotkey: 'RCtrl',
      onPressed,
      onReleased
    })

    source.emit({ hotkey: 'RCtrl', state: 'DOWN' })
    source.emit({ hotkey: 'RCtrl', state: 'UP' })

    expect(onPressed).toHaveBeenCalledTimes(1)
    expect(onReleased).toHaveBeenCalledTimes(1)
  })

  it('ignores repeated keydown events while the hotkey is held', async () => {
    const source = createFakeHotkeyEventSource()
    const service = createService(source)
    const onPressed = vi.fn()
    const onReleased = vi.fn()

    await service.setPttBinding({
      pttHotkey: 'RAlt',
      onPressed,
      onReleased
    })

    source.emit({ hotkey: 'RAlt', state: 'DOWN' })
    source.emit({ hotkey: 'RAlt', state: 'DOWN' })
    source.emit({ hotkey: 'RAlt', state: 'UP' })

    expect(onPressed).toHaveBeenCalledTimes(1)
    expect(onReleased).toHaveBeenCalledTimes(1)
  })

  it('rebinds to the latest configured hotkey', async () => {
    const source = createFakeHotkeyEventSource()
    const service = createService(source)
    const firstPressed = vi.fn()
    const secondPressed = vi.fn()

    await service.setPttBinding({
      pttHotkey: 'RCtrl',
      onPressed: firstPressed,
      onReleased: vi.fn()
    })
    await service.setPttBinding({
      pttHotkey: 'RAlt',
      onPressed: secondPressed,
      onReleased: vi.fn()
    })

    source.emit({ hotkey: 'RCtrl', state: 'DOWN' })
    source.emit({ hotkey: 'RAlt', state: 'DOWN' })

    expect(firstPressed).not.toHaveBeenCalled()
    expect(secondPressed).toHaveBeenCalledTimes(1)
  })

  it('clears bindings and stops the event source on dispose', async () => {
    const source = createFakeHotkeyEventSource()
    const service = createService(source)
    const onPressed = vi.fn()

    await service.setPttBinding({
      pttHotkey: 'RCtrl',
      onPressed,
      onReleased: vi.fn()
    })

    service.clearPttBinding()
    source.emit({ hotkey: 'RCtrl', state: 'DOWN' })
    service.dispose()

    expect(onPressed).not.toHaveBeenCalled()
    expect(source.stop).toHaveBeenCalledTimes(1)
  })

  it('stops a failing event source during setup', async () => {
    const source = createFakeHotkeyEventSource({
      startError: new Error('failed to launch helper')
    })
    const service = createService(source)

    await expect(
      service.setPttBinding({
        pttHotkey: 'RCtrl',
        onPressed: vi.fn(),
        onReleased: vi.fn()
      })
    ).rejects.toThrow('failed to launch helper')

    expect(source.stop).toHaveBeenCalledTimes(1)
  })
})

function createService(source: ReturnType<typeof createFakeHotkeyEventSource>) {
  return new HotkeyService({
    platform: 'win32',
    windowsHelperPath: 'C:\\resources\\JustSayHotkeyHelper.exe',
    createEventSource: () => source
  })
}

function createFakeHotkeyEventSource(options: { startError?: Error } = {}) {
  let listener: ((event: HotkeyEvent) => void) | null = null
  let running = false

  const source: HotkeyEventSource & {
    emit: (event: HotkeyEvent) => void
    start: ReturnType<typeof vi.fn>
    stop: ReturnType<typeof vi.fn>
  } = {
    start: vi.fn(async (onEvent: (event: HotkeyEvent) => void) => {
      if (options.startError) {
        throw options.startError
      }

      listener = onEvent
      running = true
    }),
    stop: vi.fn(() => {
      listener = null
      running = false
    }),
    isRunning: () => running,
    emit(event: HotkeyEvent) {
      listener?.(event)
    }
  }

  return source
}
