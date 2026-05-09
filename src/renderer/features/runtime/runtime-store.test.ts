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
      listHistory: async () => ({ items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 }),
      searchHistory: async () => ({ items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 }),
      getHistory: async () => null,
      deleteHistory: async () => false,
      exportHistory: async () => ({ ok: false, error: 'not implemented' })
    }

    await expect(store.hydrate(api)).resolves.toEqual(nextSnapshot)
    expect(store.getSnapshot()).toEqual(nextSnapshot)
  })
})
