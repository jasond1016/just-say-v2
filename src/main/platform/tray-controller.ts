import type { AppSettings } from '../../shared/api-types'

type WindowEvent = {
  preventDefault(): void
}

export type TrayWindowLike = {
  on(event: 'close' | 'minimize', listener: (event: WindowEvent) => void): void
  isVisible(): boolean
  show(): void
  hide(): void
  focus(): void
}

export type TrayLike = {
  setToolTip(text: string): void
  setContextMenu(menu: unknown): void
  on(event: 'click', listener: () => void): void
  destroy(): void
}

export class TrayController {
  private tray: TrayLike | null = null
  private quitting = false
  private closeListenerBound = false

  constructor(
    private readonly dependencies: {
      mainWindow: TrayWindowLike
      getSettings(): AppSettings
      createTray(iconPath: string): TrayLike
      buildMenu(template: Array<{ label: string; click: () => void }>): unknown
      iconPath: string
      quitApp(): void
    }
  ) {}

  start(): void {
    this.bindCloseListener()

    if (this.dependencies.getSettings().general.minimizeToTray) {
      this.ensureTray()
    }
  }

  /** Call when the minimizeToTray setting changes at runtime. */
  syncWithSettings(settings: AppSettings): void {
    if (settings.general.minimizeToTray) {
      this.ensureTray()
    } else {
      this.destroyTray()
    }
  }

  prepareForQuit(): void {
    this.quitting = true
  }

  dispose(): void {
    this.destroyTray()
  }

  private ensureTray(): void {
    if (this.tray) {
      return
    }

    const tray = this.dependencies.createTray(this.dependencies.iconPath)
    tray.setToolTip('JustSay V2')
    tray.setContextMenu(
      this.dependencies.buildMenu([
        {
          label: 'Open JustSay',
          click: () => {
            this.showMainWindow()
          }
        },
        {
          label: 'Quit',
          click: () => {
            this.prepareForQuit()
            this.dependencies.quitApp()
          }
        }
      ])
    )
    tray.on('click', () => {
      if (this.dependencies.mainWindow.isVisible()) {
        this.dependencies.mainWindow.hide()
        return
      }

      this.showMainWindow()
    })

    this.tray = tray
  }

  private destroyTray(): void {
    this.tray?.destroy()
    this.tray = null
  }

  private bindCloseListener(): void {
    if (this.closeListenerBound) {
      return
    }

    this.dependencies.mainWindow.on('close', (event) => {
      if (!this.shouldHideToTray()) {
        return
      }

      event.preventDefault()
      this.dependencies.mainWindow.hide()
    })
    this.dependencies.mainWindow.on('minimize', (event) => {
      if (!this.shouldHideToTray()) {
        return
      }

      event.preventDefault()
      this.dependencies.mainWindow.hide()
    })

    this.closeListenerBound = true
  }

  private shouldHideToTray(): boolean {
    return !this.quitting && this.dependencies.getSettings().general.minimizeToTray
  }

  private showMainWindow(): void {
    this.dependencies.mainWindow.show()
    this.dependencies.mainWindow.focus()
  }
}
