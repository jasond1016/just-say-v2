export type BrowserWindowLike = {
  loadURL(url: string): Promise<void> | void
  webContents?: {
    openDevTools?: () => void
    send?: (channel: string, payload?: unknown) => void
  }
}

export type BrowserWindowFactory = (options: {
  title: string
  show: boolean
  webPreferences?: {
    preload?: string
  }
}) => BrowserWindowLike

export type AppWindows = {
  mainWindow: BrowserWindowLike
  captureWindow: BrowserWindowLike
}

export type CreateWindowsOptions = {
  browserWindowFactory: BrowserWindowFactory
  rendererUrl: string
  captureUrl: string
  preloadPath: string
}

export async function createWindows(options: CreateWindowsOptions): Promise<AppWindows> {
  const mainWindow = options.browserWindowFactory({
    title: 'JustSay V2',
    show: true,
    webPreferences: {
      preload: options.preloadPath
    }
  })
  const captureWindow = options.browserWindowFactory({
    title: 'JustSay Capture',
    show: false,
    webPreferences: {
      preload: options.preloadPath
    }
  })

  await Promise.all([
    Promise.resolve(mainWindow.loadURL(options.rendererUrl)),
    Promise.resolve(captureWindow.loadURL(options.captureUrl))
  ])

  return {
    mainWindow,
    captureWindow
  }
}
