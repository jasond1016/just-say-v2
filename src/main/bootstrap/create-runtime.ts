import type { IpcMain } from 'electron'
import path from 'node:path'
import { getProfileById, profileCatalog } from '../../core/settings/profile-catalog'
import type { ResolverCredentials } from '../../core/settings/settings-resolver'
import type {
  AppSettings,
  LocalRuntimeFamilyId,
  ResolvedRuntimeConfig,
  SettingsPatch,
  TranscriptNotesRuntimeConfig,
  TranslationCredentialsInput
} from '../../shared/api-types'
import type { AppPaths } from '../app-paths'
import { createRecognitionEngine } from '../engines/create-recognition-engine'
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
import { EngineRegistry } from '../services/engine-registry'
import { getEnvironmentCredentials } from '../services/environment-credentials-provider'
import { HistoryService } from '../services/history-service'
import { ConfigurableLocalServiceController } from '../services/configurable-local-service-controller'
import { LocalServiceSupervisor } from '../services/local-service-supervisor'
import { LiveSessionActionsService } from '../services/live-session-actions-service'
import { MeetingAudioStorage } from '../services/meeting-audio-storage'
import { MeetingCoordinator } from '../services/meeting-coordinator'
import { NotesGenerationService } from '../services/notes-generation-service'
import { OutputDispatcher } from '../services/output-dispatcher'
import { PttCoordinator } from '../services/ptt-coordinator'
import { PttHotkeyController } from '../services/ptt-hotkey-controller'
import { PttHudService } from '../services/ptt-hud-service'
import { SessionCoordinator } from '../services/session-coordinator'
import { SessionService } from '../services/session-service'
import { SettingsService } from '../services/settings-service'
import { SpeechService } from '../services/speech-service'
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
  localServiceSupervisor: LocalServiceSupervisor
  transcriptDatabase: DatabaseSync
  getSettings: () => AppSettings
  shutdown: () => Promise<void>
}

export async function createRuntime(options: CreateRuntimeOptions): Promise<AppRuntime> {
  const { userDataPath, paths, platform, ipcMain, appVersion, safeStorage } = options
  const { resourcesPath, localServicePath, qwenLocalServicePath } = paths

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
  const supportedManagedLocalRuntimes: LocalRuntimeFamilyId[] =
    platform === 'win32' ? ['sensevoice'] : ['sensevoice', 'qwen3-asr']
  const baseSettingsService = new SettingsService(settingsRepository, {
    credentialsProvider: getRuntimeCredentials,
    platformProvider: () => ({
      supportedManagedLocalRuntimes: [...supportedManagedLocalRuntimes]
    })
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
      profileId: settings.speech.selectedProfileId,
      mode: settings.advanced.localServiceMode,
      localHost: settings.advanced.localServiceHost ?? null,
      localPort: settings.advanced.localServicePort ?? null,
      remoteHost: settings.advanced.remoteServiceHost ?? null,
      remotePort: settings.advanced.remoteServicePort ?? null
    })
  const localServiceSupervisor = new LocalServiceSupervisor(
    new ConfigurableLocalServiceController({
      managedRuntimePaths: {
        sensevoice: localServicePath,
        ...(platform === 'win32'
          ? {}
          : {
              'qwen3-asr': qwenLocalServicePath
            })
      },
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
        void scheduleSelectedLocalServiceProbe()
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
      configProvider: () => resolveTranscriptNotesRuntimeConfig(cachedSettings, getRuntimeCredentials())
    }
  )
  const diagnosticsService = new DiagnosticsService({
    exportDir: path.join(userDataPath, 'diagnostics'),
    appVersion,
    selectedProfileProvider: () => cachedSettings.speech.selectedProfileId
  })
  const speechService = new SpeechService(engineRegistry, localServiceSupervisor, {
    resolveRuntimeConfig: (mode) => baseSettingsService.resolveRuntimeConfig(mode),
    resolveProfileRuntimeConfig: (profileId, mode) =>
      baseSettingsService.resolveProfileRuntimeConfig(profileId, mode)
  })
  const scheduleSelectedLocalServiceProbe = async (): Promise<void> => {
    const selectedProfile = getProfileById(cachedSettings.speech.selectedProfileId)

    if (!selectedProfile?.capabilities.requiresLocalService) {
      return
    }

    await speechService.probeLocalService()
  }
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
  const sessionService = new SessionService(sessionCoordinator, liveSessionActionsService)
  const pttHudService = new PttHudService(sessionService)
  const pttHotkeyController = new PttHotkeyController(hotkeyService, settingsService, sessionCoordinator)
  sessionCoordinator.setLocalServiceStatus(localServiceSupervisor.getStatus())
  diagnosticsService.setLocalServiceStatus(localServiceSupervisor.getStatus())
  localServiceSupervisor.onStatusChange((status) => {
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
      speechService,
      historyService,
      settingsService
    },
    captureTransport,
    captureWindowService,
    meetingCoordinator,
    pttHudService,
    pttHotkeyController,
    localServiceSupervisor,
    transcriptDatabase,
    getSettings: () => cachedSettings,
    shutdown: async () => {
      pttHotkeyController.dispose()
      pttHudService.dispose()
      await localServiceSupervisor.stop()
      transcriptDatabase.close()
    }
  }
}

function resolveTranscriptNotesRuntimeConfig(
  settings: AppSettings,
  credentials: ResolverCredentials | undefined
): TranscriptNotesRuntimeConfig {
  const translationApiKey = credentials?.translationApiKey?.trim()

  if (!translationApiKey) {
    throw new Error('Translation API key is required before generating notes')
  }

  const envEndpoint = process.env.JUSTSAY_TRANSLATION_BASE_URL?.trim()
  const envModel = process.env.JUSTSAY_TRANSLATION_MODEL?.trim()

  return {
    provider: settings.translation.provider,
    language: settings.translation.targetLanguage,
    ...(settings.translation.endpoint?.trim()
      ? { endpoint: settings.translation.endpoint.trim() }
      : envEndpoint
        ? { endpoint: envEndpoint }
        : {}),
    ...(settings.translation.model?.trim()
      ? { model: settings.translation.model.trim() }
      : envModel
        ? { model: envModel }
        : {}),
    credentials: {
      translationApiKey
    }
  }
}
