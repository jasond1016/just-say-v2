import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'node:path'
import { createApp } from './bootstrap/create-app'
import { wireAppLifecycle } from './bootstrap/lifecycle'
import { createElectronIpcRegistrar } from './ipc/electron-ipc'
import type { SettingsPatch } from '../shared/api-types'
import { InMemorySettingsRepository } from './persistence/settings-repository'
import { InMemoryTranscriptRepository } from './persistence/transcript-repository'
import { CaptureWindowService, type CaptureWindowTransport } from './platform/capture-window-service'
import { HistoryService } from './services/history-service'
import { MeetingCoordinator } from './services/meeting-coordinator'
import { PttCoordinator } from './services/ptt-coordinator'
import { SessionCoordinator } from './services/session-coordinator'
import { SettingsService } from './services/settings-service'
import type { RecognitionEngine, RecognitionEvent, StartSessionInput } from '../core/contracts/engine'
import type { CaptureCommand, CaptureEvent, ResolvedRuntimeConfig } from '../shared/api-types'

void wireAppLifecycle(app, {
  onReady: async () => {
    const preloadPath = path.join(__dirname, '../preload/index.js')
    const transcriptRepository = new InMemoryTranscriptRepository()
    const settingsRepository = new InMemorySettingsRepository()
    const baseSettingsService = new SettingsService(settingsRepository, {
      credentialsProvider: () => ({
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
      }
    }
    const captureWindowService = new CaptureWindowService(createNoopCaptureTransport())
    const historyService = new HistoryService(transcriptRepository)
    const pttCoordinator = new PttCoordinator({
      settingsProvider,
      engineFactory: createStubRecognitionEngine,
      captureWindowService,
      transcriptRepository,
      outputDispatcher: {
        async deliver() {}
      }
    })
    const meetingCoordinator = new MeetingCoordinator({
      settingsProvider,
      engineFactory: createStubRecognitionEngine,
      captureWindowService,
      transcriptRepository
    })
    const sessionCoordinator = new SessionCoordinator(pttCoordinator, meetingCoordinator)

    await createApp({
      registrar: createElectronIpcRegistrar(ipcMain),
      services: {
        sessionCoordinator,
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
  }
})

function createNoopCaptureTransport(): CaptureWindowTransport {
  const listeners = new Set<(event: CaptureEvent) => void>()

  return {
    async ensureReady() {},
    async sendCommand(command) {
      queueMicrotask(() => {
        switch (command.type) {
          case 'start':
            emitCaptureEvent(listeners, {
              type: 'capture-started',
              requestId: command.requestId,
              sources: [...command.sources]
            })
            return
          case 'stop':
          case 'abort':
            emitCaptureEvent(listeners, {
              type: 'capture-stopped',
              requestId: command.requestId
            })
            return
          default:
            assertNever(command)
        }
      })
    },
    onEvent(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }
  }
}

function createStubRecognitionEngine(config: ResolvedRuntimeConfig): RecognitionEngine {
  const listeners = new Set<(event: RecognitionEvent) => void>()
  let activeSession: StartSessionInput | null = null
  let stopped = false

  return {
    async getCapabilities() {
      return {
        streaming: true,
        translation: true,
        wordTiming: false,
        speakerSeparation: false,
        requiresNetwork: false,
        requiresLocalService: false
      }
    },
    async warmup() {},
    async startSession(input) {
      activeSession = input
      stopped = false
      queueMicrotask(() => {
        emitRecognitionEvent(listeners, { type: 'session-ready' })
      })
    },
    pushAudio() {},
    async stopSession() {
      if (!activeSession || stopped) {
        return
      }

      stopped = true

      const script = createDemoScript(activeSession, config)

      for (const event of script) {
        queueMicrotask(() => {
          emitRecognitionEvent(listeners, event)
        })
      }
    },
    async abortSession() {},
    onEvent(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }
  }
}

function emitCaptureEvent(
  listeners: Set<(event: CaptureEvent) => void>,
  event: CaptureEvent
): void {
  for (const listener of listeners) {
    listener(event)
  }
}

function emitRecognitionEvent(
  listeners: Set<(event: RecognitionEvent) => void>,
  event: RecognitionEvent
): void {
  for (const listener of listeners) {
    listener(event)
  }
}

function createDemoScript(
  input: StartSessionInput,
  config: ResolvedRuntimeConfig
): RecognitionEvent[] {
  const now = Date.now()
  const translationEnabled = input.translation.enabled

  if (input.mode === 'ptt') {
    return [
      {
        type: 'block-committed',
        payload: {
          block: {
            id: `${input.sessionId}-block-1`,
            source: 'microphone',
            text: 'JustSay V2 demo PTT result.',
            startedAt: now - 1200,
            endedAt: now
          }
        }
      },
      ...(translationEnabled
        ? [
            {
              type: 'translation-updated' as const,
              payload: {
                blockId: `${input.sessionId}-block-1`,
                translatedText: getDemoTranslation(
                  config,
                  input.translation.targetLanguage,
                  '即时口语输入演示结果。'
                )
              }
            }
          ]
        : [])
    ]
  }

  return [
    {
      type: 'draft-updated',
      payload: {
        blockId: `${input.sessionId}-draft-1`,
        source: 'system',
        stableText: 'Weekly sync',
        previewText: 'Weekly sync is ready to start',
        ...(translationEnabled
          ? {
              translatedPreviewText: getDemoTranslation(
                config,
                input.translation.targetLanguage,
                '每周同步已经可以开始'
              )
            }
          : {}),
        startedAt: now - 4000,
        updatedAt: now - 1500
      }
    },
    {
      type: 'block-committed',
      payload: {
        block: {
          id: `${input.sessionId}-draft-1`,
          source: 'system',
          text: 'Weekly sync is ready to start.',
          startedAt: now - 4000,
          endedAt: now - 1000
        }
      }
    },
    ...(translationEnabled
      ? [
          {
            type: 'translation-updated' as const,
            payload: {
              blockId: `${input.sessionId}-draft-1`,
              translatedText: getDemoTranslation(
                config,
                input.translation.targetLanguage,
                '每周同步已经可以开始。'
              )
            }
          }
        ]
      : []),
    {
      type: 'session-ended'
    }
  ]
}

function getDemoTranslation(
  config: ResolvedRuntimeConfig,
  targetLanguage: string | undefined,
  fallback: string
): string {
  const resolvedTargetLanguage =
    typeof targetLanguage === 'string'
      ? targetLanguage
      : typeof config.translationConfig?.targetLanguage === 'string'
        ? config.translationConfig.targetLanguage
        : ''

  if (resolvedTargetLanguage.toLowerCase().startsWith('ja')) {
    return '毎週の同期を開始できます。'
  }

  if (resolvedTargetLanguage.toLowerCase().startsWith('en')) {
    return 'Weekly sync is ready to start.'
  }

  return fallback
}

function assertNever(value: never): never {
  throw new Error(`Unhandled demo command: ${String((value as CaptureCommand).type ?? value)}`)
}
