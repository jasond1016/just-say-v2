import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'node:path'
import { profileCatalog } from '../core/settings/profile-catalog'
import type { SettingsPatch } from '../shared/api-types'
import { createApp } from './bootstrap/create-app'
import { wireAppLifecycle } from './bootstrap/lifecycle'
import { createDemoRecognitionEngine } from './engines/demo-engine-adapter'
import { createElectronIpcRegistrar } from './ipc/electron-ipc'
import { FileTranscriptExporter } from './persistence/file-transcript-exporter'
import { InMemorySettingsRepository } from './persistence/settings-repository'
import { openSqliteDatabase } from './persistence/sqlite'
import { SqliteTranscriptRepository } from './persistence/sqlite-transcript-repository'
import { ElectronClipboardService } from './platform/clipboard-service'
import { CaptureWindowService } from './platform/capture-window-service'
import { ElectronCaptureWindowTransport } from './platform/electron-capture-window-transport'
import { OutputWindowService } from './platform/output-window-service'
import { DiagnosticsService } from './services/diagnostics-service'
import { EngineRegistry } from './services/engine-registry'
import { HistoryService } from './services/history-service'
import { LocalServiceSupervisor } from './services/local-service-supervisor'
import { MeetingCoordinator } from './services/meeting-coordinator'
import { OutputDispatcher } from './services/output-dispatcher'
import { PttCoordinator } from './services/ptt-coordinator'
import { SessionCoordinator } from './services/session-coordinator'
import { SettingsService } from './services/settings-service'
import { SpeechService } from './services/speech-service'

void wireAppLifecycle(app, {
  onReady: async () => {
    const preloadPath = path.join(__dirname, '../preload/index.js')
    const userDataPath = app.getPath('userData')
    const transcriptDatabase = openSqliteDatabase(path.join(userDataPath, 'history.db'))
    const transcriptRepository = new SqliteTranscriptRepository(transcriptDatabase)
    const transcriptExporter = new FileTranscriptExporter(
      transcriptRepository,
      path.join(userDataPath, 'exports')
    )
    const settingsRepository = new InMemorySettingsRepository()
    const baseSettingsService = new SettingsService(settingsRepository, {
      credentialsProvider: () => ({
        cloudApiKey: 'dev-cloud-key',
        translationApiKey: 'dev-translation-key'
      })
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
    const engineRegistry = new EngineRegistry(profileCatalog, createDemoRecognitionEngine)
    const localServiceSupervisor = new LocalServiceSupervisor(createDemoLocalServiceController())
    const captureTransport = new ElectronCaptureWindowTransport(ipcMain)
    const captureWindowService = new CaptureWindowService(captureTransport)
    const clipboardService = new ElectronClipboardService()
    const outputWindowService = new OutputWindowService()
    const outputDispatcher = new OutputDispatcher({
      clipboard: clipboardService,
      popup: outputWindowService
    })
    const historyService = new HistoryService(transcriptRepository, transcriptExporter)
    const diagnosticsService = new DiagnosticsService({
      exportDir: path.join(userDataPath, 'diagnostics'),
      appVersion: app.getVersion(),
      selectedProfileProvider: () => cachedSettings.speech.selectedProfileId
    })
    const speechService = new SpeechService(engineRegistry, localServiceSupervisor, {
      resolveProfileRuntimeConfig: (profileId, mode) =>
        baseSettingsService.resolveProfileRuntimeConfig(profileId, mode)
    })
    const pttCoordinator = new PttCoordinator({
      settingsProvider,
      engineFactory: (config) => engineRegistry.createForRuntimeConfig(config),
      captureWindowService,
      transcriptRepository,
      outputDispatcher,
      diagnostics: diagnosticsService
    })
    const meetingCoordinator = new MeetingCoordinator({
      settingsProvider,
      engineFactory: (config) => engineRegistry.createForRuntimeConfig(config),
      captureWindowService,
      transcriptRepository,
      diagnostics: diagnosticsService
    })
    const sessionCoordinator = new SessionCoordinator(pttCoordinator, meetingCoordinator)
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

    const appBootstrap = await createApp({
      registrar: createElectronIpcRegistrar(ipcMain),
      services: {
        sessionCoordinator,
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
      transcriptDatabase.close()
    })
  }
})

function createDemoLocalServiceController() {
  let started = false

  return {
    async start() {
      started = true
    },
    async stop() {
      started = false
    },
    async healthCheck() {
      return {
        ok: started
      }
    }
  }
}
