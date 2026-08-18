import type { IpcMain } from 'electron'
import path from 'node:path'
import { profileCatalog } from '../../core/settings/profile-catalog'
import type { AppSettings, LocalRuntimeFamilyId, SettingsPatch, TranslationCredentialsInput } from '../../shared/api-types'
import type { AppPaths } from '../app-paths'
import { FileTranscriptExporter } from '../persistence/file-transcript-exporter'
import { FileCredentialsRepository } from '../persistence/credentials-repository'
import { FileSettingsRepository } from '../persistence/settings-repository'
import { openSqliteDatabase } from '../persistence/sqlite'
import type { DatabaseSync } from 'node:sqlite'
import { SqliteTranscriptRepository } from '../persistence/sqlite-transcript-repository'
import { ElectronClipboardService } from '../platform/clipboard-service'
import { CaptureWindowService } from '../platform/capture-window-service'
import { ElectronCaptureWindowTransport } from '../platform/electron-capture-window-transport'
import { HotkeyService } from '../platform/hotkey-service'
import { OutputWindowService } from '../platform/output-window-service'
import { WindowsInputService } from '../platform/windows-input-service'
import type { CreateAppServices } from './create-app'
import { DiagnosticsService } from '../services/diagnostics-service'
import { HistoryService } from '../services/history-service'
import { ConfigurableLocalServiceController } from '../services/configurable-local-service-controller'
import { LiveSessionActionsService } from '../services/live-session-actions-service'
import { MeetingAudioStorage } from '../services/meeting-audio-storage'
import { MeetingCoordinator } from '../services/meeting-coordinator'
import { NotesGenerationService } from '../services/notes-generation-service'
import { OutputDispatcher } from '../services/output-dispatcher'
import { PttCoordinator } from '../services/ptt-coordinator'
import { PttHotkeyController } from '../services/ptt-hotkey-controller'
import { PttHudService } from '../services/ptt-hud-service'
import { RuntimeSettingsContext } from '../services/runtime-settings-context'
import { SessionCoordinator } from '../services/session-coordinator'
import { SessionService } from '../services/session-service'
import { SettingsService } from '../services/settings-service'
import { SpeechRuntime } from '../services/speech-runtime'
import { TranslationPipeline } from '../services/translation-pipeline'

export type SafeStorageAdapter = {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
}

export type CreateRuntimeOptions = {
  userDataPath: string
  paths: AppPaths
  platform: NodeJS.Platform
  ipcMain: IpcMain
  appVersion: string
  safeStorage: SafeStorageAdapter
}

export type AppRuntime = {
  services: CreateAppServices
  captureTransport: ElectronCaptureWindowTransport
  captureWindowService: CaptureWindowService
  meetingCoordinator: MeetingCoordinator
  pttHudService: PttHudService
  pttHotkeyController: PttHotkeyController
  speechRuntime: SpeechRuntime
  transcriptDatabase: DatabaseSync
  getSettings: () => AppSettings
  shutdown: () => Promise<void>
}

export async function createRuntime(options: CreateRuntimeOptions): Promise<AppRuntime> {
  const { userDataPath, paths, platform, ipcMain, appVersion, safeStorage } = options
  const {
    resourcesPath,
    localServicePath,
    nativeSenseVoiceServicePath,
    qwenLocalServicePath
  } = paths

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
  const supportedManagedLocalRuntimes: LocalRuntimeFamilyId[] =
    platform === 'win32' ? ['sensevoice'] : ['sensevoice', 'qwen3-asr']
  const baseSettingsService = new SettingsService(settingsRepository, {
    platformProvider: () => ({
      supportedManagedLocalRuntimes: [...supportedManagedLocalRuntimes]
    })
  })
  const runtimeSettings = await RuntimeSettingsContext.create({
    settingsService: baseSettingsService,
    credentialsRepository
  })
  const speechRuntime = SpeechRuntime.create({
    profiles: profileCatalog,
    localServiceController: new ConfigurableLocalServiceController({
      managedRuntimePaths: {
        sensevoice: localServicePath,
        sensevoiceNative: nativeSenseVoiceServicePath,
        ...(platform === 'win32'
          ? {}
          : {
              'qwen3-asr': qwenLocalServicePath
            })
      },
      healthTimeoutMs: 60_000
    }),
    runtimeConfigResolver: runtimeSettings.createRuntimeConfigResolver()
  })
  const scheduleSelectedLocalServiceProbe = async (): Promise<void> => {
    if (!runtimeSettings.shouldProbeSelectedLocalService()) {
      return
    }

    await speechRuntime.probeLocalService()
  }
  runtimeSettings.onDeploymentSignatureChange(async () => {
    await speechRuntime.stop()
    void scheduleSelectedLocalServiceProbe()
  })
  const settingsService = {
    getSettings: () => runtimeSettings.getSettings(),
    updateSettings: (patch: SettingsPatch) => runtimeSettings.updateSettings(patch),
    saveTranslationCredentials: (input: TranslationCredentialsInput) =>
      runtimeSettings.saveTranslationCredentials(input),
    onChanged: (listener: (settings: AppSettings) => void) => runtimeSettings.onChanged(listener)
  }
  const settingsProvider = runtimeSettings.createSettingsProvider()
  const captureTransport = new ElectronCaptureWindowTransport(ipcMain)
  const captureWindowService = new CaptureWindowService(captureTransport)
  const clipboardService = new ElectronClipboardService()
  const outputWindowService = new OutputWindowService()
  const inputService = platform === 'win32' ? new WindowsInputService(clipboardService) : undefined
  const outputDispatcher = new OutputDispatcher({
    clipboard: clipboardService,
    popup: outputWindowService,
    ...(inputService ? { input: inputService } : {})
  })
  const hotkeyService = new HotkeyService({
    windowsHelperPath: path.join(resourcesPath, 'windows-hotkey-helper', 'JustSayHotkeyHelper.exe')
  })
  const notesGenerationService = new NotesGenerationService()
  const historyService = new HistoryService(
    transcriptRepository,
    transcriptExporter,
    clipboardService,
    meetingAudioStorage,
    {
      repository: transcriptRepository,
      generationService: notesGenerationService,
      configProvider: () => runtimeSettings.resolveTranscriptNotesRuntimeConfig()
    }
  )
  const diagnosticsService = new DiagnosticsService({
    exportDir: path.join(userDataPath, 'diagnostics'),
    appVersion,
    selectedProfileProvider: () => runtimeSettings.getCachedSettings().speech.selectedProfileId
  })
  const translationPipeline = new TranslationPipeline()
  const pttCoordinator = new PttCoordinator({
    settingsProvider,
    engineFactory: (config) => speechRuntime.createEngine(config),
    captureWindowService,
    transcriptRepository,
    outputDispatcher,
    translationPipeline,
    diagnostics: diagnosticsService
  })
  const meetingCoordinator = new MeetingCoordinator({
    settingsProvider,
    engineFactory: (config) => speechRuntime.createEngine(config),
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
  const sessionService = new SessionService(sessionCoordinator, liveSessionActionsService)
  const pttHudService = new PttHudService(sessionService)
  const pttHotkeyController = new PttHotkeyController(hotkeyService, settingsService, sessionCoordinator)
  sessionCoordinator.setLocalServiceStatus(speechRuntime.getStatus())
  diagnosticsService.setLocalServiceStatus(speechRuntime.getStatus())
  speechRuntime.onStatusChange((status) => {
    sessionCoordinator.setLocalServiceStatus(status)
    diagnosticsService.setLocalServiceStatus(status)
  })
  void scheduleSelectedLocalServiceProbe()
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

  return {
    services: {
      sessionService,
      pttHudService,
      diagnosticsService,
      speechService: speechRuntime,
      historyService,
      settingsService
    },
    captureTransport,
    captureWindowService,
    meetingCoordinator,
    pttHudService,
    pttHotkeyController,
    speechRuntime,
    transcriptDatabase,
    getSettings: () => runtimeSettings.getSettings(),
    shutdown: async () => {
      pttHotkeyController.dispose()
      pttHudService.dispose()
      await speechRuntime.stop()
      transcriptDatabase.close()
    }
  }
}
