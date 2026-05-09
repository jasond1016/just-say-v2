import { app, BrowserWindow, desktopCapturer, ipcMain, session } from 'electron'
import path from 'node:path'
import { profileCatalog } from '../core/settings/profile-catalog'
import type { SettingsPatch } from '../shared/api-types'
import { createApp } from './bootstrap/create-app'
import { wireAppLifecycle } from './bootstrap/lifecycle'
import { createRecognitionEngine } from './engines/create-recognition-engine'
import { createElectronIpcRegistrar } from './ipc/electron-ipc'
import { FileTranscriptExporter } from './persistence/file-transcript-exporter'
import { FileSettingsRepository } from './persistence/settings-repository'
import { openSqliteDatabase } from './persistence/sqlite'
import { SqliteTranscriptRepository } from './persistence/sqlite-transcript-repository'
import { ElectronClipboardService } from './platform/clipboard-service'
import { CaptureWindowService } from './platform/capture-window-service'
import { registerElectronDisplayMediaHandler } from './platform/electron-display-media-handler'
import { ElectronCaptureWindowTransport } from './platform/electron-capture-window-transport'
import { HotkeyService } from './platform/hotkey-service'
import { OutputWindowService } from './platform/output-window-service'
import { WindowsInputService } from './platform/windows-input-service'
import { DiagnosticsService } from './services/diagnostics-service'
import { EngineRegistry } from './services/engine-registry'
import { getEnvironmentCredentials } from './services/environment-credentials-provider'
import { HistoryService } from './services/history-service'
import { LocalServiceSupervisor } from './services/local-service-supervisor'
import { LiveSessionActionsService } from './services/live-session-actions-service'
import { MeetingCoordinator } from './services/meeting-coordinator'
import { OutputDispatcher } from './services/output-dispatcher'
import { PttCoordinator } from './services/ptt-coordinator'
import { PttHotkeyController } from './services/ptt-hotkey-controller'
import { SessionCoordinator } from './services/session-coordinator'
import { SettingsService } from './services/settings-service'
import { SpeechService } from './services/speech-service'
import { PythonLocalServiceController } from './services/python-local-service-controller'
import { TranslationPipeline } from './services/translation-pipeline'

void wireAppLifecycle(app, {
  onReady: async () => {
    registerElectronDisplayMediaHandler(session.defaultSession, desktopCapturer)

    const preloadPath = path.join(__dirname, '../preload/index.js')
    const resourcesPath = path.join(__dirname, '../resources')
    const userDataPath = app.getPath('userData')
    const transcriptDatabase = openSqliteDatabase(path.join(userDataPath, 'history.db'))
    const transcriptRepository = new SqliteTranscriptRepository(transcriptDatabase)
    const transcriptExporter = new FileTranscriptExporter(
      transcriptRepository,
      path.join(userDataPath, 'exports')
    )
    const settingsRepository = new FileSettingsRepository(path.join(userDataPath, 'settings.json'))
    const baseSettingsService = new SettingsService(settingsRepository, {
      credentialsProvider: () => getEnvironmentCredentials()
    })
    let cachedSettings = await baseSettingsService.getSettings()
    let cachedRuntimeConfigs = {
      ptt: await baseSettingsService.resolveRuntimeConfig('ptt'),
      meeting: await baseSettingsService.resolveRuntimeConfig('meeting')
    }

    const refreshSettingsCache = async (): Promise<void> => {
      cachedSettings = await baseSettingsService.getSettings()
      cachedRuntimeConfigs = {
        ptt: await baseSettingsService.resolveRuntimeConfig('ptt'),
        meeting: await baseSettingsService.resolveRuntimeConfig('meeting')
      }
    }

    const settingsProvider = {
      getSettings: () => cachedSettings,
      resolveRuntimeConfig: (mode: 'ptt' | 'meeting') => cachedRuntimeConfigs[mode]
    }
    const settingsService = {
      getSettings: async () => baseSettingsService.getSettings(),
      updateSettings: async (patch: SettingsPatch) => {
        const updated = await baseSettingsService.updateSettings(patch)
        await refreshSettingsCache()
        return updated
      },
      onChanged: (listener: (settings: Awaited<ReturnType<typeof baseSettingsService.getSettings>>) => void) =>
        baseSettingsService.onChanged(listener)
    }
    const localServiceHost = cachedSettings.advanced.localServiceHost ?? '127.0.0.1'
    const localServicePort = cachedSettings.advanced.localServicePort ?? 8765
    const localServiceSupervisor = new LocalServiceSupervisor(
      new PythonLocalServiceController({
        host: localServiceHost,
        port: localServicePort,
        scriptPath: path.join(resourcesPath, 'local-service', 'service.py'),
        workingDirectory: path.join(resourcesPath, 'local-service')
      })
    )
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
    const historyService = new HistoryService(transcriptRepository, transcriptExporter, clipboardService)
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
            icon: path.join(__dirname, '../icon.png'),
            ...(webPreferences ? { webPreferences } : {})
          }),
        rendererUrl: `file://${path.join(__dirname, '../renderer/index.html')}`,
        captureUrl: `file://${path.join(__dirname, '../renderer/index.html')}#capture`,
        preloadPath
      }
    })

    captureTransport.attachWindow(appBootstrap.windows.captureWindow)
    app.on('before-quit', () => {
      pttHotkeyController.dispose()
      void localServiceSupervisor.stop()
      transcriptDatabase.close()
    })
  }
})
