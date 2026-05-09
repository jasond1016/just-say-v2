import { describe, expect, it } from 'vitest'

import type { AppApi } from '../../../preload/api'
import { INITIAL_RUNTIME_SNAPSHOT, RuntimeStore } from './runtime-store'

describe('RuntimeStore', () => {
  it('starts from the initial runtime snapshot', () => {
    const store = new RuntimeStore()

    expect(store.getSnapshot()).toEqual(INITIAL_RUNTIME_SNAPSHOT)
  })

  it('hydrates from the app api and updates the current snapshot', async () => {
    const store = new RuntimeStore()
    const nextSnapshot = {
      ptt: {
        status: 'idle' as const,
        lastResult: {
          text: 'hello',
          deliveredAt: 123,
          deliveryMethod: 'simulate_input' as const
        }
      },
      liveSession: null,
      services: {
        localService: 'healthy' as const
      }
    }

    const api: AppApi = {
      getRuntime: async () => nextSnapshot,
      onRuntimeSnapshot: () => () => {},
      onRuntimeNotification: () => () => {},
      getSettings: async () => ({
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
      }),
      onSettingsChanged: () => () => {},
      updateSettings: async () => ({
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
      }),
      listSpeechProfiles: async () => [],
      testSpeechProfile: async () => ({
        ok: true,
        profileId: 'local-fast'
      }),
      prewarmSession: async () => undefined,
      startPtt: async () => undefined,
      stopPtt: async () => undefined,
      startMeeting: async () => undefined,
      stopMeeting: async () => undefined,
      copyLiveSession: async () => undefined,
      exportLiveSession: async () => ({ ok: false, error: 'not implemented' }),
      listHistory: async () => ({ items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 }),
      searchHistory: async () => ({ items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 }),
      getHistory: async () => null,
      deleteHistory: async () => false,
      copyHistory: async () => undefined,
      exportHistory: async () => ({ ok: false, error: 'not implemented' }),
      exportDiagnostics: async () => ({ ok: false, error: 'not implemented' })
    }

    await expect(store.hydrate(api)).resolves.toEqual(nextSnapshot)
    expect(store.getSnapshot()).toEqual(nextSnapshot)
  })

  it('updates the current snapshot from runtime push events', () => {
    const store = new RuntimeStore()
    const nextSnapshot: import('../../../shared/api-types').AppRuntimeSnapshot = {
      ptt: {
        status: 'capturing' as const
      },
      liveSession: null,
      services: {
        localService: 'starting' as const
      }
    }

    let runtimeListener: ((snapshot: import('../../../shared/api-types').AppRuntimeSnapshot) => void) | undefined
    const api: AppApi = {
      getRuntime: async () => nextSnapshot,
      onRuntimeSnapshot: (listener) => {
        runtimeListener = listener
        return () => {
          runtimeListener = undefined
        }
      },
      onRuntimeNotification: () => () => {},
      getSettings: async () => createSettings(),
      onSettingsChanged: () => () => {},
      updateSettings: async () => createSettings(),
      listSpeechProfiles: async () => [],
      testSpeechProfile: async () => ({ ok: true, profileId: 'local-fast' }),
      prewarmSession: async () => undefined,
      startPtt: async () => undefined,
      stopPtt: async () => undefined,
      startMeeting: async () => undefined,
      stopMeeting: async () => undefined,
      copyLiveSession: async () => undefined,
      exportLiveSession: async () => ({ ok: false, error: 'not implemented' }),
      listHistory: async () => ({ items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 }),
      searchHistory: async () => ({ items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 }),
      getHistory: async () => null,
      deleteHistory: async () => false,
      copyHistory: async () => undefined,
      exportHistory: async () => ({ ok: false, error: 'not implemented' }),
      exportDiagnostics: async () => ({ ok: false, error: 'not implemented' })
    }

    const seen: Array<typeof nextSnapshot> = []
    const disconnect = store.connect((snapshot) => {
      seen.push(snapshot)
    }, api)

    runtimeListener?.(nextSnapshot)
    disconnect()

    expect(seen).toEqual([nextSnapshot])
    expect(store.getSnapshot()).toEqual(nextSnapshot)
  })
})

function createSettings() {
  return {
    general: {
      language: 'zh-CN' as const,
      theme: 'system' as const,
      launchAtLogin: false,
      minimizeToTray: true
    },
    speech: {
      selectedProfileId: 'local-fast',
      language: 'auto' as const
    },
    input: {
      pttHotkey: 'RCtrl' as const,
      includeMicrophoneInMeeting: false,
      microphoneDeviceId: 'default' as const
    },
    output: {
      method: 'simulate_input' as const
    },
    translation: {
      enabledForPtt: false,
      enabledForMeeting: false,
      targetLanguage: 'en',
      provider: 'openai-compatible' as const
    },
    advanced: {
      diagnosticsEnabled: true,
      experimentalFlags: []
    }
  }
}
