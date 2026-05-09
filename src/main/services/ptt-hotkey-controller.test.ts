import { describe, expect, it, vi } from 'vitest'
import { createDefaultSettings } from '../../core/settings/settings-schema'
import type { AppSettings } from '../../shared/api-types'
import { PttHotkeyController } from './ptt-hotkey-controller'

describe('PttHotkeyController', () => {
  it('binds the current settings and forwards press and release events', async () => {
    const settings = createDefaultSettings()
    const harness = createHarness(settings)

    await harness.controller.start()
    await harness.hotkeyService.triggerPressed()
    await harness.hotkeyService.triggerReleased()

    expect(harness.hotkeyService.bindings).toEqual(['RCtrl'])
    expect(harness.sessionCoordinator.startPtt).toHaveBeenCalledTimes(1)
    expect(harness.sessionCoordinator.stopPtt).toHaveBeenCalledTimes(1)
  })

  it('rebinds when settings change', async () => {
    const settings = createDefaultSettings()
    const harness = createHarness(settings)

    await harness.controller.start()
    harness.settingsProvider.emit({
      ...settings,
      input: {
        ...settings.input,
        pttHotkey: 'RAlt'
      }
    })

    expect(harness.hotkeyService.bindings).toEqual(['RCtrl', 'RAlt'])
  })

  it('swallows coordinator errors raised by edge-triggered hotkey events', async () => {
    const settings = createDefaultSettings()
    const harness = createHarness(settings, {
      startError: new Error('PTT session is already active'),
      stopError: new Error('No active PTT session')
    })

    await harness.controller.start()

    await expect(harness.hotkeyService.triggerPressed()).resolves.toBeUndefined()
    await expect(harness.hotkeyService.triggerReleased()).resolves.toBeUndefined()
  })

  it('fails startup when hotkey binding fails', async () => {
    const settings = createDefaultSettings()
    const harness = createHarness(settings, {
      bindingError: new Error('helper startup failed')
    })

    await expect(harness.controller.start()).rejects.toThrow('helper startup failed')
    expect(harness.hotkeyService.dispose).not.toHaveBeenCalled()
  })

  it('disposes the hotkey service and settings subscription', async () => {
    const settings = createDefaultSettings()
    const harness = createHarness(settings)

    await harness.controller.start()
    harness.controller.dispose()

    expect(harness.hotkeyService.dispose).toHaveBeenCalledTimes(1)
    expect(harness.settingsProvider.unsubscribe).toHaveBeenCalledTimes(1)
  })
})

function createHarness(
  settings: AppSettings,
  options: {
    startError?: Error
    stopError?: Error
    bindingError?: Error
  } = {}
) {
  let latestBinding:
    | {
        onPressed: () => void | Promise<void>
        onReleased: () => void | Promise<void>
      }
    | undefined

  const hotkeyService = {
    bindings: [] as AppSettings['input']['pttHotkey'][],
    setPttBinding: vi.fn(
      async (binding: {
        pttHotkey: AppSettings['input']['pttHotkey']
        onPressed: () => void | Promise<void>
        onReleased: () => void | Promise<void>
      }) => {
        if (options.bindingError) {
          throw options.bindingError
        }

        hotkeyService.bindings.push(binding.pttHotkey)
        latestBinding = binding
      }
    ),
    dispose: vi.fn(),
    async triggerPressed() {
      await latestBinding?.onPressed()
    },
    async triggerReleased() {
      await latestBinding?.onReleased()
    }
  }

  const settingsListeners = new Set<(settings: AppSettings) => void>()
  const settingsProvider = {
    unsubscribe: vi.fn(),
    getSettings: vi.fn(async () => settings),
    onChanged: vi.fn((listener: (settings: AppSettings) => void) => {
      settingsListeners.add(listener)
      return () => {
        settingsListeners.delete(listener)
        settingsProvider.unsubscribe()
      }
    }),
    emit(nextSettings: AppSettings) {
      for (const listener of settingsListeners) {
        listener(nextSettings)
      }
    }
  }

  const sessionCoordinator = {
    startPtt: vi.fn(async () => {
      if (options.startError) {
        throw options.startError
      }
    }),
    stopPtt: vi.fn(async () => {
      if (options.stopError) {
        throw options.stopError
      }
    })
  }

  return {
    hotkeyService,
    settingsProvider,
    sessionCoordinator,
    controller: new PttHotkeyController(
      hotkeyService as never,
      settingsProvider,
      sessionCoordinator as never
    )
  }
}
