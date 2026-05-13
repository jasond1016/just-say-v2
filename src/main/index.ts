import { app, BrowserWindow, desktopCapturer, ipcMain, Menu, safeStorage, session, Tray } from 'electron'
import path from 'node:path'
import { profileCatalog } from '../core/settings/profile-catalog'
import type {
  AppSettings,
  ResolvedRuntimeConfig,
  SettingsPatch,
  TranslationCredentialsInput
} from '../shared/api-types'
import { resolveAppPaths } from './app-paths'
import { createApp } from './bootstrap/create-app'
import { wireAppLifecycle } from './bootstrap/lifecycle'
import { createRecognitionEngine } from './engines/create-recognition-engine'
import { createElectronIpcRegistrar } from './ipc/electron-ipc'
import { FileTranscriptExporter } from './persistence/file-transcript-exporter'
import { FileCredentialsRepository } from './persistence/credentials-repository'
import { FileSettingsRepository } from './persistence/settings-repository'
import { openSqliteDatabase } from './persistence/sqlite'
import { SqliteTranscriptRepository } from './persistence/sqlite-transcript-repository'
import { ElectronClipboardService } from './platform/clipboard-service'
import { CaptureWindowService } from './platform/capture-window-service'
import { registerElectronDisplayMediaHandler } from './platform/electron-display-media-handler'
import { ElectronCaptureWindowTransport } from './platform/electron-capture-window-transport'
import { HotkeyService } from './platform/hotkey-service'
import { OutputWindowService } from './platform/output-window-service'
import { TrayController } from './platform/tray-controller'
import { WindowsInputService } from './platform/windows-input-service'
import { DiagnosticsService } from './services/diagnostics-service'
import { EngineRegistry } from './services/engine-registry'
import { getEnvironmentCredentials } from './services/environment-credentials-provider'
import { HistoryService } from './services/history-service'
import { ConfigurableLocalServiceController } from './services/configurable-local-service-controller'
import { LocalServiceSupervisor } from './services/local-service-supervisor'
import { LiveSessionActionsService } from './services/live-session-actions-service'
import { MeetingAudioStorage } from './services/meeting-audio-storage'
import { MeetingCoordinator } from './services/meeting-coordinator'
import { OutputDispatcher } from './services/output-dispatcher'
import { PttCoordinator } from './services/ptt-coordinator'
import { PttHotkeyController } from './services/ptt-hotkey-controller'
import { SessionCoordinator } from './services/session-coordinator'
import { SettingsService } from './services/settings-service'
import { SpeechService } from './services/speech-service'
import { TranslationPipeline } from './services/translation-pipeline'
import type { ResolverCredentials } from '../core/settings/settings-resolver'

const remoteDebuggingPort = process.env.JUSTSAY_REMOTE_DEBUGGING_PORT
if (remoteDebuggingPort) {
  app.commandLine.appendSwitch('remote-debugging-port', remoteDebuggingPort)
}

void wireAppLifecycle(app, {
  onReady: async () => {
    registerElectronDisplayMediaHandler(session.defaultSession, desktopCapturer)

    const { preloadPath, resourcesPath, localServicePath, rendererIndexPath, iconPath } = resolveAppPaths(__dirname)
    const userDataPath = app.getPath('userData')
    const transcriptDatabase = openSqliteDatabase(path.join(userDataPath, 'history.db'))
    const transcriptRepository = new SqliteTranscriptRepository(transcriptDatabase)
    const transcriptExporter = new FileTranscriptExporter(
      transcriptRepository,
      path.join(userDataPath, 'exports')
    )
    const meetingAudioStorage = new MeetingAudioStorage(path.join(userDataPath, 'audio'))
    await meetingAudioStorage.cleanupTemp()
    const settingsRepository = new FileSettingsRepository(path.join(userDataPath, 'settings.json'))
    const credentialsRepository = new FileCredentialsRepository(
      path.join(userDataPath, 'translation-credentials.bin'),
      {
        isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
        encryptString: (value) => safeStorage.encryptString(value),
        decryptString: (value) => safeStorage.decryptString(value)
      }
    )
    let cachedStoredCredentials = (await credentialsRepository.get()) ?? {}
    const getRuntimeCredentials = (): ResolverCredentials | undefined => {
      const environmentCredentials = getEnvironmentCredentials()
      const merged: ResolverCredentials = {
        ...(environmentCredentials ?? {}),
        ...cachedStoredCredentials
      }

      return merged.cloudApiKey || merged.translationApiKey ? merged : undefined
    }
    const baseSettingsService = new SettingsService(settingsRepository, {
      credentialsProvider: getRuntimeCredentials
    })
    const settingsListeners = new Set<(settings: AppSettings) => void>()
    baseSettingsService.onChanged((settings) => {
      for (const listener of settingsListeners) {
        listener(settings)
      }
    })
    let cachedSettings = await baseSettingsService.getSettings()
    let cachedRuntimeConfigs: Partial<Record<'ptt' | 'meeting', ResolvedRuntimeConfig>> = {}
    let cachedRuntimeConfigErrors: Partial<Record<'ptt' | 'meeting', Error>> = {}

    const refreshSettingsCache = async (): Promise<void> => {
      cachedSettings = await baseSettingsService.getSettings()

      const nextRuntimeConfigs: Partial<Record<'ptt' | 'meeting', ResolvedRuntimeConfig>> = {}
      const nextRuntimeConfigErrors: Partial<Record<'ptt' | 'meeting', Error>> = {}

      for (const mode of ['ptt', 'meeting'] as const) {
        try {
          nextRuntimeConfigs[mode] = await baseSettingsService.resolveRuntimeConfig(mode)
        } catch (errorLike) {
          nextRuntimeConfigErrors[mode] =
            errorLike instanceof Error ? errorLike : new Error(`Could not resolve ${mode} runtime config`)
        }
      }

      cachedRuntimeConfigs = nextRuntimeConfigs
      cachedRuntimeConfigErrors = nextRuntimeConfigErrors
    }
    await refreshSettingsCache()

    const resolveCachedRuntimeConfig = (mode: 'ptt' | 'meeting'): ResolvedRuntimeConfig => {
      const error = cachedRuntimeConfigErrors[mode]

      if (error) {
        throw error
      }

      const runtimeConfig = cachedRuntimeConfigs[mode]

      if (!runtimeConfig) {
        throw new Error(`Runtime config for ${mode} is unavailable`)
      }

      return runtimeConfig
    }

    const settingsProvider = {
      getSettings: () => cachedSettings,
      resolveRuntimeConfig: (mode: 'ptt' | 'meeting') => resolveCachedRuntimeConfig(mode)
    }
    const getLocalServiceSettingsSignature = (settings: AppSettings) =>
      JSON.stringify({
        mode: settings.advanced.localServiceMode,
        localHost: settings.advanced.localServiceHost ?? null,
        localPort: settings.advanced.localServicePort ?? null,
        remoteHost: settings.advanced.remoteServiceHost ?? null,
        remotePort: settings.advanced.remoteServicePort ?? null
      })
    const localServiceSupervisor = new LocalServiceSupervisor(
      new ConfigurableLocalServiceController({
        getSettings: () => cachedSettings,
        localServicePath,
        healthTimeoutMs: 60_000
      })
    )
    const settingsService = {
      getSettings: async () => baseSettingsService.getSettings(),
      updateSettings: async (patch: SettingsPatch) => {
        const previousLocalServiceSettingsSignature = getLocalServiceSettingsSignature(cachedSettings)
        const updated = await baseSettingsService.updateSettings(patch)
        await refreshSettingsCache()
        if (getLocalServiceSettingsSignature(cachedSettings) !== previousLocalServiceSettingsSignature) {
          await localServiceSupervisor.stop()
        }
        return updated
      },
      saveTranslationCredentials: async (input: TranslationCredentialsInput) => {
        await credentialsRepository.save({
          ...cachedStoredCredentials,
          translationApiKey: input.apiKey
        })
        cachedStoredCredentials = (await credentialsRepository.get()) ?? {}
        await refreshSettingsCache()
        const settings = await baseSettingsService.getSettings()

        for (const listener of settingsListeners) {
          listener(settings)
        }

        return settings
      },
      onChanged: (listener: (settings: Awaited<ReturnType<typeof baseSettingsService.getSettings>>) => void) => {
        settingsListeners.add(listener)

        return () => {
          settingsListeners.delete(listener)
        }
      }
    }
    const engineRegistry = new EngineRegistry(profileCatalog, (config) =>
      createRecognitionEngine(config, { localServiceSupervisor })
    )
    const captureTransport = new ElectronCaptureWindowTransport(ipcMain)
    const captureWindowService = new CaptureWindowService(captureTransport)
    const clipboardService = new ElectronClipboardService()
    const outputWindowService = new OutputWindowService()
    const inputService = process.platform === 'win32' ? new WindowsInputService(clipboardService) : undefined
    const outputDispatcher = new OutputDispatcher({
      clipboard: clipboardService,
      popup: outputWindowService,
      ...(inputService ? { input: inputService } : {})
    })
    const hotkeyService = new HotkeyService({
      windowsHelperPath: path.join(resourcesPath, 'windows-hotkey-helper', 'JustSayHotkeyHelper.exe')
    })
    const historyService = new HistoryService(
      transcriptRepository,
      transcriptExporter,
      clipboardService,
      meetingAudioStorage
    )
    const diagnosticsService = new DiagnosticsService({
      exportDir: path.join(userDataPath, 'diagnostics'),
      appVersion: app.getVersion(),
      selectedProfileProvider: () => cachedSettings.speech.selectedProfileId
    })
    const speechService = new SpeechService(engineRegistry, localServiceSupervisor, {
      resolveProfileRuntimeConfig: (profileId, mode) =>
        baseSettingsService.resolveProfileRuntimeConfig(profileId, mode)
    })
    const translationPipeline = new TranslationPipeline()
    const pttCoordinator = new PttCoordinator({
      settingsProvider,
      engineFactory: (config) => engineRegistry.createForRuntimeConfig(config),
      captureWindowService,
      transcriptRepository,
      outputDispatcher,
      translationPipeline,
      diagnostics: diagnosticsService
    })
    const meetingCoordinator = new MeetingCoordinator({
      settingsProvider,
      engineFactory: (config) => engineRegistry.createForRuntimeConfig(config),
      captureWindowService,
      transcriptRepository,
      translationPipeline,
      audioRecorderFactory: ({ sessionId, chunkMs }) =>
        meetingAudioStorage.createRecorder({ sessionId, chunkMs }),
      deletePersistedAudio: (relativePath) => meetingAudioStorage.deleteRelativePath(relativePath),
      diagnostics: diagnosticsService
    })
    const sessionCoordinator = new SessionCoordinator(pttCoordinator, meetingCoordinator)
    const liveSessionActionsService = new LiveSessionActionsService({
      getRuntimeSnapshot: () => sessionCoordinator.getRuntimeSnapshot(),
      clipboard: clipboardService,
      exportDir: path.join(userDataPath, 'exports')
    })
    const sessionService = {
      getRuntimeSnapshot: () => sessionCoordinator.getRuntimeSnapshot(),
      onSnapshot: (listener: Parameters<typeof sessionCoordinator.onSnapshot>[0]) =>
        sessionCoordinator.onSnapshot(listener),
      onNotification: (listener: Parameters<NonNullable<typeof sessionCoordinator.onNotification>>[0]) =>
        sessionCoordinator.onNotification(listener),
      prewarm: (mode: 'ptt' | 'meeting') => sessionCoordinator.prewarm(mode),
      startPtt: () => sessionCoordinator.startPtt(),
      stopPtt: () => sessionCoordinator.stopPtt(),
      copyLatestPttText: () => sessionCoordinator.copyLatestPttText(),
      startMeeting: (input?: Parameters<typeof sessionCoordinator.startMeeting>[0]) =>
        sessionCoordinator.startMeeting(input),
      stopMeeting: () => sessionCoordinator.stopMeeting(),
      copyLiveSession: () => liveSessionActionsService.copyPlainText(),
      exportLiveSession: (format: Parameters<typeof liveSessionActionsService.export>[0]) =>
        liveSessionActionsService.export(format)
    }
    const pttHotkeyController = new PttHotkeyController(hotkeyService, settingsService, sessionCoordinator)
    sessionCoordinator.setLocalServiceStatus(localServiceSupervisor.getStatus())
    diagnosticsService.setLocalServiceStatus(localServiceSupervisor.getStatus())
    localServiceSupervisor.onStatusChange((status) => {
      sessionCoordinator.setLocalServiceStatus(status)
      diagnosticsService.setLocalServiceStatus(status)
    })
    sessionCoordinator.onSnapshot((snapshot) => {
      if (snapshot.liveSession?.status === 'stopped_unexpectedly' || snapshot.ptt.error) {
        diagnosticsService.setLatestFailedSession(snapshot)
        return
      }

      if (snapshot.liveSession === null && !snapshot.ptt.error) {
        diagnosticsService.clearLatestFailedSession()
      }
    })
    await pttHotkeyController.start()

    const appBootstrap = await createApp({
      registrar: createElectronIpcRegistrar(ipcMain),
      services: {
        sessionCoordinator: sessionService,
        diagnosticsService,
        speechService,
        historyService,
        settingsService
      },
      windows: {
        browserWindowFactory: ({ title, show, webPreferences }) =>
          new BrowserWindow({
            title,
            show,
            width: title === 'JustSay Capture' ? 800 : 1280,
            height: title === 'JustSay Capture' ? 600 : 860,
            backgroundColor: '#10161f',
            icon: iconPath,
            ...(webPreferences ? { webPreferences } : {})
          }),
        rendererUrl: `file://${rendererIndexPath}`,
        captureUrl: `file://${rendererIndexPath}#capture`,
        preloadPath
      }
    })
    captureTransport.attachWindow(appBootstrap.windows.captureWindow)
    const trayController = new TrayController({
      mainWindow: appBootstrap.windows.mainWindow as BrowserWindow,
      getSettings: () => cachedSettings,
      createTray: (iconPath) => new Tray(iconPath),
      buildMenu: (template) => Menu.buildFromTemplate(template),
      iconPath,
      quitApp: () => app.quit()
    })
    trayController.start()
    let shutdownPromise: Promise<void> | null = null
    const shutdown = async (): Promise<void> => {
      trayController.prepareForQuit()
      trayController.dispose()
      pttHotkeyController.dispose()
      await localServiceSupervisor.stop()
      transcriptDatabase.close()
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
