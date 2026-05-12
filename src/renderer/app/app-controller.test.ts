import { describe, expect, it, vi } from 'vitest'

import type { AppApi } from '../../preload/api'
import type { AppRuntimeSnapshot, AppSettings, SavedTranscript, SettingsPatch } from '../../shared/api-types'
import { RuntimeStore } from '../features/runtime/runtime-store'
import { AppController } from './app-controller'

describe('AppController', () => {
  it('bootstraps state and prefers the live session section when a meeting is active', async () => {
    const runtime = createLiveRuntimeSnapshot()
    const historyItems = [createHistoryItem('meeting-1', 'meeting')]
    const api = createApi({
      runtime,
      listHistory: vi.fn(async () => ({
        items: historyItems,
        total: historyItems.length,
        page: 1,
        pageSize: 20,
        totalPages: 1
      })),
      listSpeechProfiles: vi.fn(async () => [createProfile()])
    })
    const controller = new AppController({
      api,
      runtimeStore: new RuntimeStore()
    })

    const dispose = controller.start()
    await flushPromises()
    const state = controller.getSnapshot()

    expect(state.runtime).toEqual(runtime)
    expect(state.activeSection).toBe('live-session')
    expect(state.history).toEqual(historyItems)
    expect(state.historyTotal).toBe(1)
    expect(state.profiles).toEqual([createProfile()])

    dispose()
  })

  it('switches to the live session section when runtime push events report a meeting', async () => {
    let runtimeListener: ((snapshot: AppRuntimeSnapshot) => void) | undefined
    const api = createApi({
      onRuntimeSnapshot: (listener) => {
        runtimeListener = listener
        return () => {
          runtimeListener = undefined
        }
      }
    })
    const controller = new AppController({
      api,
      runtimeStore: new RuntimeStore()
    })

    const dispose = controller.start()
    await flushPromises()

    runtimeListener?.(createLiveRuntimeSnapshot())

    expect(controller.getSnapshot().activeSection).toBe('live-session')

    dispose()
  })

  it('refreshes history through search when the query changes', async () => {
    const searchHistory = vi.fn(async () => ({
      items: [createHistoryItem('meeting-2', 'meeting')],
      total: 1,
      page: 1,
      pageSize: 20,
      totalPages: 1
    }))
    const api = createApi({
      searchHistory
    })
    const controller = new AppController({
      api,
      runtimeStore: new RuntimeStore()
    })

    const dispose = controller.start()
    await flushPromises()

    await controller.setHistoryQuery('  meeting  ')

    expect(searchHistory).toHaveBeenCalledWith({ query: 'meeting' })
    expect(controller.getSnapshot().history).toEqual([createHistoryItem('meeting-2', 'meeting')])

    dispose()
  })

  it('applies history source and time filters when refreshing history', async () => {
    const listHistory = vi.fn(async () => ({
      items: [createHistoryItem('meeting-2', 'meeting')],
      total: 1,
      page: 1,
      pageSize: 20,
      totalPages: 1
    }))
    const controller = new AppController({
      api: createApi({
        listHistory
      }),
      runtimeStore: new RuntimeStore(),
      now: () => new Date('2026-01-15T12:00:00.000Z').getTime()
    })

    const dispose = controller.start()
    await flushPromises()

    await controller.setHistorySource('system')
    await controller.setHistoryTimeFilter('last_7_days')

    expect(listHistory).toHaveBeenLastCalledWith({
      source: 'system',
      startedAfter: new Date('2026-01-08T12:00:00.000Z').getTime()
    })

    dispose()
  })

  it('starts a meeting with settings-derived options and refreshes runtime state', async () => {
    const startMeeting = vi.fn(async () => undefined)
    let runtime = createIdleRuntimeSnapshot()
    const api = createApi({
      startMeeting,
      getRuntime: vi.fn(async () => runtime),
      getSettings: vi.fn(async () => ({
        ...createSettings(),
        input: {
          ...createSettings().input,
          includeMicrophoneInMeeting: true
        },
        translation: {
          ...createSettings().translation,
          enabledForMeeting: true,
          targetLanguage: 'ja'
        }
      }))
    })
    const controller = new AppController({
      api,
      runtimeStore: new RuntimeStore()
    })

    const dispose = controller.start()
    await flushPromises()
    runtime = createLiveRuntimeSnapshot()

    await controller.startMeeting()
    await flushPromises()

    expect(startMeeting).toHaveBeenCalledWith({
      includeMicrophone: true,
      translationEnabled: true,
      targetLanguage: 'ja'
    })
    expect(controller.getSnapshot().runtime).toEqual(runtime)
    expect(controller.getSnapshot().busyAction).toBeNull()

    dispose()
  })

  it('copies and exports the active live session through the API', async () => {
    const copyLiveSession = vi.fn(async () => undefined)
    const exportLiveSession = vi.fn(async () => ({
      ok: true,
      path: 'C:\\exports\\live-session-meeting-1.txt'
    }))
    const controller = new AppController({
      api: createApi({
        runtime: createLiveRuntimeSnapshot(),
        copyLiveSession,
        exportLiveSession
      }),
      runtimeStore: new RuntimeStore()
    })

    const dispose = controller.start()
    await flushPromises()

    await controller.copyLiveSession()
    await controller.exportLiveSession('plain_text')

    expect(copyLiveSession).toHaveBeenCalled()
    expect(exportLiveSession).toHaveBeenCalledWith('plain_text')
    expect(controller.getSnapshot().liveSessionMessage).toBe(
      'Saved the live transcript to C:\\exports\\live-session-meeting-1.txt'
    )

    dispose()
  })

  it('copies the latest ptt text through the API', async () => {
    const copyLatestPttText = vi.fn(async () => undefined)
    const controller = new AppController({
      api: createApi({
        copyLatestPttText
      }),
      runtimeStore: new RuntimeStore()
    })

    const dispose = controller.start()
    await flushPromises()

    await controller.copyLatestPttText()

    expect(copyLatestPttText).toHaveBeenCalled()
    dispose()
  })

  it('updates editable settings fields through the API and refreshes local state', async () => {
    let settings = createSettings()
    const updateSettings = vi.fn(async (patch: SettingsPatch) => {
      settings = mergeSettings(settings, patch)
      return settings
    })
    const api = createApi({
      getSettings: vi.fn(async () => settings),
      updateSettings
    })
    const controller = new AppController({
      api,
      runtimeStore: new RuntimeStore()
    })

    const dispose = controller.start()
    await flushPromises()

    await controller.setGeneralLanguage('en-US')
    await controller.setTheme('dark')
    await controller.setMinimizeToTray(false)
    await controller.setSpeechLanguage('ja')
    await controller.setPttHotkey('RAlt')
    await controller.setOutputMethod('clipboard')
    await controller.setIncludeMicrophoneInMeeting(true)
    await controller.setTranslationEnabledForPtt(true)
    await controller.setTranslationEnabledForMeeting(true)
    await controller.setTranslationTargetLanguage('fr')
    await controller.setTranslationProvider('openai-compatible')
    await controller.setTranslationEndpoint('https://example.test/v1')
    await controller.setTranslationModel('gpt-4o-mini')
    await controller.setLocalServiceHost('10.0.0.8')
    await controller.setLocalServicePort(9001)

    expect(updateSettings).toHaveBeenCalledWith({ general: { language: 'en-US' } })
    expect(updateSettings).toHaveBeenCalledWith({ general: { theme: 'dark' } })
    expect(updateSettings).toHaveBeenCalledWith({ general: { minimizeToTray: false } })
    expect(updateSettings).toHaveBeenCalledWith({ speech: { language: 'ja' } })
    expect(updateSettings).toHaveBeenCalledWith({ input: { pttHotkey: 'RAlt' } })
    expect(updateSettings).toHaveBeenCalledWith({ output: { method: 'clipboard' } })
    expect(updateSettings).toHaveBeenCalledWith({ input: { includeMicrophoneInMeeting: true } })
    expect(updateSettings).toHaveBeenCalledWith({ translation: { enabledForPtt: true } })
    expect(updateSettings).toHaveBeenCalledWith({ translation: { enabledForMeeting: true } })
    expect(updateSettings).toHaveBeenCalledWith({ translation: { targetLanguage: 'fr' } })
    expect(updateSettings).toHaveBeenCalledWith({ translation: { provider: 'openai-compatible' } })
    expect(updateSettings).toHaveBeenCalledWith({ translation: { endpoint: 'https://example.test/v1' } })
    expect(updateSettings).toHaveBeenCalledWith({ translation: { model: 'gpt-4o-mini' } })
    expect(updateSettings).toHaveBeenCalledWith({ advanced: { localServiceHost: '10.0.0.8' } })
    expect(updateSettings).toHaveBeenCalledWith({ advanced: { localServicePort: 9001 } })
    expect(controller.getSnapshot().settings).toMatchObject({
      general: {
        language: 'en-US',
        theme: 'dark',
        minimizeToTray: false
      },
      speech: {
        language: 'ja'
      },
      input: {
        pttHotkey: 'RAlt',
        includeMicrophoneInMeeting: true
      },
      output: {
        method: 'clipboard'
      },
      translation: {
        enabledForPtt: true,
        enabledForMeeting: true,
        targetLanguage: 'fr',
        provider: 'openai-compatible',
        endpoint: 'https://example.test/v1',
        model: 'gpt-4o-mini'
      },
      advanced: {
        localServiceHost: '10.0.0.8',
        localServicePort: 9001
      }
    })

    dispose()
  })

  it('saves translation credentials through the API and refreshes local settings state', async () => {
    let settings = createSettings()
    const saveTranslationCredentials = vi.fn(async ({ apiKey }: { apiKey: string }) => {
      expect(apiKey).toBe('translation-secret')
      settings = {
        ...settings,
        translation: {
          ...settings.translation,
          apiKeyConfigured: true
        }
      }
      return settings
    })
    const controller = new AppController({
      api: createApi({
        getSettings: vi.fn(async () => settings),
        saveTranslationCredentials
      }),
      runtimeStore: new RuntimeStore()
    })

    const dispose = controller.start()
    await flushPromises()

    await controller.saveTranslationCredentials('translation-secret')

    expect(saveTranslationCredentials).toHaveBeenCalledWith({
      apiKey: 'translation-secret'
    })
    expect(controller.getSnapshot().settings.translation.apiKeyConfigured).toBe(true)

    dispose()
  })

  it('copies history detail text through the API', async () => {
    const copyHistory = vi.fn(async () => undefined)
    const controller = new AppController({
      api: createApi({
        copyHistory
      }),
      runtimeStore: new RuntimeStore()
    })

    const dispose = controller.start()
    await flushPromises()

    await controller.copyHistoryItem('tx-1', 'plain_text')

    expect(copyHistory).toHaveBeenCalledWith('tx-1', 'plain_text')
    expect(controller.getSnapshot().exportMessage).toBe('Copied the transcript text to the clipboard.')

    dispose()
  })

  it('cancels pending bootstrap work when stopped before startup completes', async () => {
    const firstRuntime = createDeferred<AppRuntimeSnapshot>()
    const firstSettings = createDeferred<AppSettings>()
    const firstProfiles = createDeferred<ReturnType<typeof createProfile>[]>()
    const firstHistory = createDeferred<{
      items: SavedTranscript[]
      total: number
      page: number
      pageSize: number
      totalPages: number
    }>()

    const api = createApi({
      getSettings: vi.fn().mockImplementationOnce(async () => firstSettings.promise),
      listSpeechProfiles: vi.fn().mockImplementationOnce(async () => firstProfiles.promise),
      listHistory: vi.fn().mockImplementationOnce(async () => firstHistory.promise)
    })
    const runtimeStore = createRuntimeStoreMock({
      refresh: vi.fn().mockImplementationOnce(async () => firstRuntime.promise)
    })
    const controller = new AppController({
      api,
      runtimeStore
    })

    const stopFirst = controller.start()
    stopFirst()

    firstRuntime.resolve(createIdleRuntimeSnapshot())
    firstSettings.resolve({
      ...createSettings(),
      general: {
        ...createSettings().general,
        theme: 'dark'
      }
    })
    firstProfiles.resolve([])
    firstHistory.resolve({
      items: [createHistoryItem('stale', 'ptt')],
      total: 1,
      page: 1,
      pageSize: 20,
      totalPages: 1
    })
    await flushPromises()

    expect(controller.getSnapshot()).toMatchObject({
      activeSection: 'quick-dictation',
      history: [],
      runtime: {
        liveSession: null,
        services: {
          localService: 'stopped'
        }
      },
      settings: {
        general: {
          theme: 'system'
        }
      }
    })
  })
})

function createApi(overrides: Partial<AppApi> & {
  runtime?: AppRuntimeSnapshot
} = {}): AppApi {
  const runtime = overrides.runtime ?? createIdleRuntimeSnapshot()
  const settings = createSettings()

  return {
    getRuntime: overrides.getRuntime ?? vi.fn(async () => runtime),
    onRuntimeSnapshot: overrides.onRuntimeSnapshot ?? (() => () => {}),
    onRuntimeNotification: overrides.onRuntimeNotification ?? (() => () => {}),
    getSettings: overrides.getSettings ?? vi.fn(async () => settings),
    onSettingsChanged: overrides.onSettingsChanged ?? (() => () => {}),
    updateSettings: overrides.updateSettings ?? vi.fn(async () => settings),
    saveTranslationCredentials:
      overrides.saveTranslationCredentials ?? vi.fn(async () => settings),
    listSpeechProfiles: overrides.listSpeechProfiles ?? vi.fn(async () => []),
    testSpeechProfile: overrides.testSpeechProfile ?? vi.fn(async (profileId) => ({ ok: true, profileId })),
    prewarmSession: overrides.prewarmSession ?? vi.fn(async () => undefined),
    startPtt: overrides.startPtt ?? vi.fn(async () => undefined),
    stopPtt: overrides.stopPtt ?? vi.fn(async () => undefined),
    copyLatestPttText: overrides.copyLatestPttText ?? vi.fn(async () => undefined),
    startMeeting: overrides.startMeeting ?? vi.fn(async () => undefined),
    stopMeeting: overrides.stopMeeting ?? vi.fn(async () => undefined),
    copyLiveSession: overrides.copyLiveSession ?? vi.fn(async () => undefined),
    exportLiveSession:
      overrides.exportLiveSession ?? vi.fn(async () => ({ ok: false, error: 'not implemented' })),
    listHistory:
      overrides.listHistory ??
      vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 })),
    searchHistory:
      overrides.searchHistory ??
      vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 })),
    getHistory: overrides.getHistory ?? vi.fn(async () => null),
    deleteHistory: overrides.deleteHistory ?? vi.fn(async () => false),
    copyHistory: overrides.copyHistory ?? vi.fn(async () => undefined),
    exportHistory: overrides.exportHistory ?? vi.fn(async () => ({ ok: false, error: 'not implemented' })),
    exportDiagnostics: overrides.exportDiagnostics ?? vi.fn(async () => ({ ok: false, error: 'not implemented' }))
  }
}

function createRuntimeStoreMock(overrides: {
  refresh?: RuntimeStore['refresh']
} = {}): RuntimeStore {
  const store = new RuntimeStore()

  if (overrides.refresh) {
    store.refresh = (async (api) => {
      const snapshot = await overrides.refresh!(api)
      store.setSnapshot(snapshot)
      return snapshot
    }) as RuntimeStore['refresh']
  }

  return store
}

function createIdleRuntimeSnapshot(): AppRuntimeSnapshot {
  return {
    ptt: {
      status: 'idle'
    },
    liveSession: null,
    services: {
      localService: 'healthy'
    }
  }
}

function createLiveRuntimeSnapshot(): AppRuntimeSnapshot {
  return {
    ptt: {
      status: 'idle'
    },
    liveSession: {
      sessionId: 'meeting-1',
      status: 'streaming',
      startedAt: 100,
      durationSec: 12,
      transcript: {
        committedBlocks: [],
        activeDrafts: {},
        revision: 1
      },
      engineProfileId: 'local-fast',
      translationEnabled: false
    },
    services: {
      localService: 'healthy'
    }
  }
}

function createHistoryItem(id: string, mode: SavedTranscript['mode']): SavedTranscript {
  return {
    id,
    mode,
    title: `${mode}:${id}`,
    startedAt: 1,
    endedAt: 2,
    plainText: 'hello world',
    blocks: [],
    metadata: {
      engineProfileId: 'local-fast',
      includeMicrophone: mode === 'meeting',
      translationEnabled: false
    }
  }
}

function createSettings(): AppSettings {
  return {
    general: {
      language: 'zh-CN',
      theme: 'system',
      launchAtLogin: false,
      minimizeToTray: true
    },
    speech: {
      selectedProfileId: 'local-fast',
      language: 'auto'
    },
    input: {
      pttHotkey: 'RCtrl',
      includeMicrophoneInMeeting: false,
      microphoneDeviceId: 'default'
    },
    output: {
      method: 'simulate_input'
    },
    translation: {
      enabledForPtt: false,
      enabledForMeeting: false,
      targetLanguage: 'en',
      provider: 'openai-compatible'
    },
    advanced: {
      diagnosticsEnabled: true,
      experimentalFlags: []
    }
  }
}

function createProfile() {
  return {
    id: 'local-fast',
    label: 'Local Fast',
    kind: 'local' as const,
    preset: 'local-fast' as const,
    capabilities: {
      streaming: true,
      translation: false,
      wordTiming: false,
      speakerSeparation: false,
      requiresNetwork: false,
      requiresLocalService: true
    }
  }
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })

  return {
    promise,
    resolve
  }
}

function mergeSettings(settings: AppSettings, patch: SettingsPatch): AppSettings {
  return {
    general: {
      ...settings.general,
      ...patch.general
    },
    speech: {
      ...settings.speech,
      ...patch.speech
    },
    input: {
      ...settings.input,
      ...patch.input
    },
    output: {
      ...settings.output,
      ...patch.output
    },
    translation: {
      ...settings.translation,
      ...patch.translation
    },
    advanced: {
      ...settings.advanced,
      ...patch.advanced,
      experimentalFlags: patch.advanced?.experimentalFlags
        ? [...patch.advanced.experimentalFlags]
        : [...settings.advanced.experimentalFlags]
    }
  }
}

async function flushPromises(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
}
