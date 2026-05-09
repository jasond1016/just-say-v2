import { describe, expect, it, vi } from 'vitest'

import type { AppApi } from '../../preload/api'
import type { AppRuntimeSnapshot, AppSettings, SavedTranscript } from '../../shared/api-types'
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

    const dispose = await controller.start()
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

    const dispose = await controller.start()

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

    const dispose = await controller.start()

    await controller.setHistoryQuery('  meeting  ')

    expect(searchHistory).toHaveBeenCalledWith({ query: 'meeting' })
    expect(controller.getSnapshot().history).toEqual([createHistoryItem('meeting-2', 'meeting')])

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

    const dispose = await controller.start()
    runtime = createLiveRuntimeSnapshot()

    await controller.startMeeting()

    expect(startMeeting).toHaveBeenCalledWith({
      includeMicrophone: true,
      translationEnabled: true,
      targetLanguage: 'ja'
    })
    expect(controller.getSnapshot().runtime).toEqual(runtime)
    expect(controller.getSnapshot().busyAction).toBeNull()

    dispose()
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
    listSpeechProfiles: overrides.listSpeechProfiles ?? vi.fn(async () => []),
    testSpeechProfile: overrides.testSpeechProfile ?? vi.fn(async (profileId) => ({ ok: true, profileId })),
    prewarmSession: overrides.prewarmSession ?? vi.fn(async () => undefined),
    startPtt: overrides.startPtt ?? vi.fn(async () => undefined),
    stopPtt: overrides.stopPtt ?? vi.fn(async () => undefined),
    startMeeting: overrides.startMeeting ?? vi.fn(async () => undefined),
    stopMeeting: overrides.stopMeeting ?? vi.fn(async () => undefined),
    listHistory:
      overrides.listHistory ??
      vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 })),
    searchHistory:
      overrides.searchHistory ??
      vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 })),
    getHistory: overrides.getHistory ?? vi.fn(async () => null),
    deleteHistory: overrides.deleteHistory ?? vi.fn(async () => false),
    exportHistory: overrides.exportHistory ?? vi.fn(async () => ({ ok: false, error: 'not implemented' })),
    exportDiagnostics: overrides.exportDiagnostics ?? vi.fn(async () => ({ ok: false, error: 'not implemented' }))
  }
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
