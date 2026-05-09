import type { PttHotkey } from '../../shared/api-types'
import { WindowsHotkeyHelperSource } from './windows-hotkey-helper'

export type HotkeyBinding = {
  pttHotkey: PttHotkey
  onPressed: () => void | Promise<void>
  onReleased: () => void | Promise<void>
}

export type HotkeyEvent = {
  hotkey: PttHotkey
  state: 'DOWN' | 'UP'
}

export interface HotkeyEventSource {
  start(onEvent: (event: HotkeyEvent) => void): Promise<void>
  stop(): void
  isRunning(): boolean
}

export type HotkeyServiceOptions = {
  platform?: NodeJS.Platform
  windowsHelperPath?: string
  createEventSource?: (platform: NodeJS.Platform, windowsHelperPath?: string) => HotkeyEventSource
}

export class HotkeyService {
  private readonly platform: NodeJS.Platform
  private readonly windowsHelperPath: string | undefined
  private readonly createEventSource: NonNullable<HotkeyServiceOptions['createEventSource']>
  private eventSource: HotkeyEventSource | null = null
  private activeBinding: HotkeyBinding | null = null
  private pressedHotkey: PttHotkey | null = null

  constructor(options: HotkeyServiceOptions = {}) {
    this.platform = options.platform ?? process.platform
    this.windowsHelperPath = options.windowsHelperPath
    this.createEventSource = options.createEventSource ?? defaultCreateHotkeyEventSource
  }

  async setPttBinding(binding: HotkeyBinding): Promise<void> {
    if (!this.eventSource?.isRunning()) {
      const eventSource = this.createEventSource(this.platform, this.windowsHelperPath)

      try {
        await eventSource.start((event) => {
          this.handleEvent(event)
        })
      } catch (error) {
        eventSource.stop()
        throw error
      }

      this.eventSource = eventSource
    }

    this.activeBinding = binding
    this.pressedHotkey = null
  }

  clearPttBinding(): void {
    this.activeBinding = null
    this.pressedHotkey = null
  }

  dispose(): void {
    this.eventSource?.stop()
    this.eventSource = null
    this.activeBinding = null
    this.pressedHotkey = null
  }

  private handleEvent(event: HotkeyEvent): void {
    const binding = this.activeBinding

    if (!binding || event.hotkey !== binding.pttHotkey) {
      return
    }

    if (event.state === 'DOWN') {
      if (this.pressedHotkey === event.hotkey) {
        return
      }

      this.pressedHotkey = event.hotkey
      void binding.onPressed()
      return
    }

    if (this.pressedHotkey !== event.hotkey) {
      return
    }

    this.pressedHotkey = null
    void binding.onReleased()
  }
}

function defaultCreateHotkeyEventSource(
  platform: NodeJS.Platform,
  windowsHelperPath?: string
): HotkeyEventSource {
  if (platform === 'win32') {
    if (!windowsHelperPath) {
      throw new Error('Windows hotkey helper path is required on Windows')
    }

    return new WindowsHotkeyHelperSource({
      helperPath: windowsHelperPath
    })
  }

  return new NodeGlobalKeyListenerSource()
}

type LegacyKeyState = 'DOWN' | 'UP'

type LegacyKeyEvent = {
  rawKey?: {
    name?: string
  }
  state: LegacyKeyState
}

type LegacyKeyListener = (event: LegacyKeyEvent) => boolean

interface LegacyGlobalKeyboardListenerLike {
  addListener(listener: LegacyKeyListener): Promise<void>
  removeListener(listener: LegacyKeyListener): void
  kill(): void
}

class NodeGlobalKeyListenerSource implements HotkeyEventSource {
  private listenerClient: LegacyGlobalKeyboardListenerLike | null = null
  private onEvent: ((event: HotkeyEvent) => void) | null = null
  private readonly listener: LegacyKeyListener

  constructor(
    private readonly createListener: () => LegacyGlobalKeyboardListenerLike = defaultCreateLegacyListener
  ) {
    this.listener = (event) => {
      const hotkey = matchLegacyHotkey(event)

      if (hotkey && this.onEvent) {
        this.onEvent({
          hotkey,
          state: event.state
        })
      }

      return false
    }
  }

  async start(onEvent: (event: HotkeyEvent) => void): Promise<void> {
    if (this.listenerClient) {
      return
    }

    this.onEvent = onEvent
    const listenerClient = this.createListener()

    try {
      await listenerClient.addListener(this.listener)
    } catch (error) {
      listenerClient.kill()
      this.onEvent = null
      throw error
    }

    this.listenerClient = listenerClient
  }

  stop(): void {
    if (!this.listenerClient) {
      this.onEvent = null
      return
    }

    this.listenerClient.removeListener(this.listener)
    this.listenerClient.kill()
    this.listenerClient = null
    this.onEvent = null
  }

  isRunning(): boolean {
    return this.listenerClient !== null
  }
}

function defaultCreateLegacyListener(): LegacyGlobalKeyboardListenerLike {
  const { GlobalKeyboardListener } = require('node-global-key-listener') as {
    GlobalKeyboardListener: new () => LegacyGlobalKeyboardListenerLike
  }

  return new GlobalKeyboardListener()
}

function matchLegacyHotkey(event: LegacyKeyEvent): PttHotkey | null {
  if (event.rawKey?.name === 'RCONTROL') {
    return 'RCtrl'
  }

  if (event.rawKey?.name === 'RALT') {
    return 'RAlt'
  }

  return null
}
