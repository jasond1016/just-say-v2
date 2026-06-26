import { app, BrowserWindow, desktopCapturer, ipcMain, Menu, safeStorage, screen, session, Tray } from 'electron'
import { resolveAppPaths } from './app-paths'
import { createApp } from './bootstrap/create-app'
import { createRuntime } from './bootstrap/create-runtime'
import { wireAppLifecycle } from './bootstrap/lifecycle'
import { createElectronIpcRegistrar } from './ipc/electron-ipc'
import { registerElectronDisplayMediaHandler } from './platform/electron-display-media-handler'
import { PttHudWindowController } from './platform/ptt-hud-window-controller'
import { TrayController } from './platform/tray-controller'

const remoteDebuggingPort = process.env.JUSTSAY_REMOTE_DEBUGGING_PORT
if (remoteDebuggingPort) {
  app.commandLine.appendSwitch('remote-debugging-port', remoteDebuggingPort)
}

// Prevent Chromium from killing the app after repeated GPU process crashes
app.commandLine.appendSwitch('disable-gpu-process-crash-limit')

void wireAppLifecycle(app, {
  onReady: async () => {
    registerElectronDisplayMediaHandler(session.defaultSession, desktopCapturer)

    const paths = resolveAppPaths(__dirname)
    const runtime = await createRuntime({
      userDataPath: app.getPath('userData'),
      paths,
      platform: process.platform,
      ipcMain,
      appVersion: app.getVersion(),
      safeStorage: {
        isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
        encryptString: (value) => safeStorage.encryptString(value),
        decryptString: (value) => safeStorage.decryptString(value)
      }
    })

    const appBootstrap = await createApp({
      registrar: createElectronIpcRegistrar(ipcMain),
      services: runtime.services,
      windows: {
        browserWindowFactory: ({ kind, title, show, webPreferences }) =>
          createWindowByKind(kind, {
            title,
            show,
            iconPath: paths.iconPath,
            ...(webPreferences ? { webPreferences } : {})
          }),
        rendererUrl: `file://${paths.rendererIndexPath}`,
        captureUrl: `file://${paths.rendererIndexPath}#capture`,
        hudUrl: `file://${paths.rendererIndexPath}#hud`,
        preloadPath: paths.preloadPath
      }
    })
    runtime.captureTransport.attachWindow(appBootstrap.windows.captureWindow)

    // Resilience: recover from GPU/renderer crashes in the capture window
    const captureWebContents = (appBootstrap.windows.captureWindow as BrowserWindow).webContents
    captureWebContents.on('render-process-gone', (_event, details) => {
      console.warn('[capture] Renderer process gone:', details.reason, details.exitCode)
      // Reset transport readiness so it re-polls after reload
      runtime.captureTransport.resetReady()
      // Notify the meeting coordinator that capture was lost
      if (runtime.captureWindowService.getState().activeRequest) {
        runtime.meetingCoordinator.handleCaptureProcessGone()
      }
      // Reload the capture window so audio capture can resume
      setTimeout(() => {
        if (!captureWebContents.isDestroyed()) {
          captureWebContents.reload()
        }
      }, 2000)
    })

    const mainWebContents = (appBootstrap.windows.mainWindow as BrowserWindow).webContents
    mainWebContents.on('render-process-gone', (_event, details) => {
      console.warn('[main] Renderer process gone:', details.reason, details.exitCode)
      setTimeout(() => {
        if (!mainWebContents.isDestroyed()) {
          mainWebContents.reload()
        }
      }, 1000)
    })

    // Resilience: handle GPU process crash without exiting the app
    app.on('child-process-gone', (_event, details) => {
      if (details.type === 'GPU') {
        console.warn('[app] GPU process crashed:', details.reason, '— Chromium will restart it automatically')
      }
    })

    const pttHudWindowController = new PttHudWindowController(
      appBootstrap.windows.hudWindow as BrowserWindow,
      runtime.pttHudService
    )
    const trayController = new TrayController({
      mainWindow: appBootstrap.windows.mainWindow as BrowserWindow,
      getSettings: runtime.getSettings,
      createTray: (iconPath) => new Tray(iconPath),
      buildMenu: (template) => Menu.buildFromTemplate(template),
      iconPath: paths.iconPath,
      quitApp: () => app.quit()
    })
    trayController.start()
    runtime.services.settingsService.onChanged?.((settings) => {
      trayController.syncWithSettings(settings)
    })
    let shutdownPromise: Promise<void> | null = null
    const shutdown = async (): Promise<void> => {
      trayController.prepareForQuit()
      trayController.dispose()
      pttHudWindowController.dispose()
      await runtime.shutdown()
    }
    app.on('before-quit', (event) => {
      if (shutdownPromise) {
        event.preventDefault()
        return
      }

      event.preventDefault()
      shutdownPromise = shutdown()
      void shutdownPromise
        .catch((error) => {
          console.error(
            '[app] Failed to shut down local resources cleanly',
            error instanceof Error ? error.message : error
          )
        })
        .finally(() => {
          app.exit(0)
        })
    })
  }
})

function createWindowByKind(
  kind: 'main' | 'capture' | 'hud',
  input: {
    title: string
    show: boolean
    iconPath: string
    webPreferences?: {
      preload?: string
    }
  }
): BrowserWindow {
  if (kind === 'hud') {
    const display = screen.getPrimaryDisplay()
    const hudWidth = 440
    const hudHeight = 112
    const x = Math.round(display.workArea.x + (display.workArea.width - hudWidth) / 2)
    const y = Math.round(display.workArea.y + display.workArea.height - hudHeight - 48)

    return new BrowserWindow({
      title: input.title,
      show: input.show,
      width: hudWidth,
      height: hudHeight,
      x,
      y,
      transparent: true,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      autoHideMenuBar: true,
      alwaysOnTop: true,
      focusable: true,
      hasShadow: false,
      backgroundColor: '#00000000',
      ...(input.webPreferences ? { webPreferences: input.webPreferences } : {})
    })
  }

  return new BrowserWindow({
    title: input.title,
    show: input.show,
    width: kind === 'capture' ? 800 : 1280,
    height: kind === 'capture' ? 600 : 860,
    backgroundColor: '#10161f',
    icon: input.iconPath,
    ...(kind === 'main' ? {
      titleBarStyle: 'hidden',
      titleBarOverlay: {
        color: '#ffffff',
        symbolColor: '#5c4a3a',
        height: 36
      }
    } : {}),
    ...(input.webPreferences ? {
      webPreferences: {
        ...input.webPreferences,
        ...(kind === 'capture' ? { backgroundThrottling: false } : {})
      }
    } : {})
  })
}
