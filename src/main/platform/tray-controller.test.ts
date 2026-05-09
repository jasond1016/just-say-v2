import { describe, expect, it, vi } from 'vitest'
import { TrayController } from './tray-controller'

describe('TrayController', () => {
  it('hides the main window instead of closing when minimize-to-tray is enabled', () => {
    const harness = createHarness(true)

    harness.controller.start()
    const event = createWindowEvent()
    harness.windowListeners.close?.(event)

    expect(event.preventDefault).toHaveBeenCalled()
    expect(harness.mainWindow.hide).toHaveBeenCalled()
  })

  it('hides the main window on minimize when minimize-to-tray is enabled', () => {
    const harness = createHarness(true)

    harness.controller.start()
    const event = createWindowEvent()
    harness.windowListeners.minimize?.(event)

    expect(event.preventDefault).toHaveBeenCalled()
    expect(harness.mainWindow.hide).toHaveBeenCalled()
  })

  it('leaves native close behavior alone when minimize-to-tray is disabled', () => {
    const harness = createHarness(false)

    harness.controller.start()
    const event = createWindowEvent()
    harness.windowListeners.close?.(event)

    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(harness.mainWindow.hide).not.toHaveBeenCalled()
  })

  it('toggles the main window from the tray icon and quits through the tray menu', () => {
    const harness = createHarness(true)

    harness.controller.start()
    harness.visible = false
    harness.trayListeners.click?.()
    harness.visible = true
    harness.trayListeners.click?.()
    harness.menuTemplate[1]?.click()

    expect(harness.mainWindow.show).toHaveBeenCalled()
    expect(harness.mainWindow.focus).toHaveBeenCalled()
    expect(harness.mainWindow.hide).toHaveBeenCalled()
    expect(harness.quitApp).toHaveBeenCalled()
  })

  it('allows the app to quit after prepareForQuit is called', () => {
    const harness = createHarness(true)

    harness.controller.start()
    harness.controller.prepareForQuit()
    const event = createWindowEvent()
    harness.windowListeners.close?.(event)

    expect(event.preventDefault).not.toHaveBeenCalled()
  })
})

function createHarness(minimizeToTray: boolean) {
  const windowListeners: Partial<Record<'close' | 'minimize', (event: ReturnType<typeof createWindowEvent>) => void>> = {}
  const trayListeners: Partial<Record<'click', () => void>> = {}
  const menuTemplate: Array<{ label: string; click: () => void }> = []
  const quitApp = vi.fn()
  let visible = true

  const mainWindow = {
    on: vi.fn((event: 'close' | 'minimize', listener: (event: ReturnType<typeof createWindowEvent>) => void) => {
      windowListeners[event] = listener
    }),
    isVisible: vi.fn(() => visible),
    show: vi.fn(() => {
      visible = true
    }),
    hide: vi.fn(() => {
      visible = false
    }),
    focus: vi.fn()
  }
  const tray = {
    setToolTip: vi.fn(),
    setContextMenu: vi.fn(),
    on: vi.fn((event: 'click', listener: () => void) => {
      trayListeners[event] = listener
    }),
    destroy: vi.fn()
  }

  const controller = new TrayController({
    mainWindow,
    getSettings: () => ({
      general: {
        language: 'zh-CN',
        theme: 'system',
        launchAtLogin: false,
        minimizeToTray
      },
      speech: {
        selectedProfileId: 'local-fast',
        language: 'auto'
      },
      input: {
        pttHotkey: 'RCtrl',
        includeMicrophoneInMeeting: false,
        microphoneDeviceId: 'default'
      },
      output: {
        method: 'simulate_input'
      },
      translation: {
        enabledForPtt: false,
        enabledForMeeting: false,
        targetLanguage: 'en',
        provider: 'openai-compatible'
      },
      advanced: {
        diagnosticsEnabled: true,
        experimentalFlags: []
      }
    }),
    createTray: () => tray,
    buildMenu: (template) => {
      menuTemplate.splice(0, menuTemplate.length, ...template)
      return template
    },
    iconPath: 'C:\\icon.png',
    quitApp
  })

  return {
    controller,
    mainWindow,
    quitApp,
    trayListeners,
    windowListeners,
    menuTemplate,
    get visible() {
      return visible
    },
    set visible(value: boolean) {
      visible = value
    }
  }
}

function createWindowEvent() {
  return {
    preventDefault: vi.fn()
  }
}
