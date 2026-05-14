export type BrowserWindowLike = {
  loadURL(url: string): Promise<void> | void
  removeMenu?: () => void
  webContents?: {
    openDevTools?: () => void
    send?: (channel: string, payload?: unknown) => void
  }
}

export type BrowserWindowFactory = (options: {
  kind: 'main' | 'capture' | 'hud'
  title: string
  show: boolean
  webPreferences?: {
    preload?: string
  }
}) => BrowserWindowLike

export type AppWindows = {
  mainWindow: BrowserWindowLike
  captureWindow: BrowserWindowLike
  hudWindow: BrowserWindowLike
}

export type CreateWindowsOptions = {
  browserWindowFactory: BrowserWindowFactory
  rendererUrl: string
  captureUrl: string
  hudUrl: string
  preloadPath: string
}

export async function createWindows(options: CreateWindowsOptions): Promise<AppWindows> {
  const mainWindow = options.browserWindowFactory({
    kind: 'main',
    title: 'JustSay V2',
    show: true,
    webPreferences: {
      preload: options.preloadPath
    }
  })
  const captureWindow = options.browserWindowFactory({
    kind: 'capture',
    title: 'JustSay Capture',
    show: false,
    webPreferences: {
      preload: options.preloadPath
    }
  })
  const hudWindow = options.browserWindowFactory({
    kind: 'hud',
    title: 'JustSay HUD',
    show: false,
    webPreferences: {
      preload: options.preloadPath
    }
  })

  if (process.platform !== 'darwin') {
    mainWindow.removeMenu?.()
    captureWindow.removeMenu?.()
    hudWindow.removeMenu?.()
  }

  await Promise.all([
    Promise.resolve(mainWindow.loadURL(options.rendererUrl)),
    Promise.resolve(captureWindow.loadURL(options.captureUrl)),
    Promise.resolve(hudWindow.loadURL(options.hudUrl))
  ])

  return {
    mainWindow,
    captureWindow,
    hudWindow
  }
}
