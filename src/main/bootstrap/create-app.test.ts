import { describe, expect, it, vi } from 'vitest'

import { createApp } from './create-app'

describe('createApp', () => {
  it('registers session/history handlers and creates the app windows', async () => {
    const registrations: string[] = []
    const mainWindowEvents: Array<{ channel: string; payload: unknown }> = []
    const sessionCoordinator = {
      getRuntimeSnapshot: vi.fn().mockReturnValue({
        ptt: { status: 'idle' },
        liveSession: null,
        services: { localService: 'stopped' }
      }),
      onSnapshot: vi.fn().mockImplementation((listener) => {
        listener({
          ptt: { status: 'idle' },
          liveSession: null,
          services: { localService: 'stopped' }
        })
        return () => {}
      }),
      prewarm: vi.fn().mockResolvedValue(undefined),
      startPtt: vi.fn().mockResolvedValue(undefined),
      stopPtt: vi.fn().mockResolvedValue(undefined),
      startMeeting: vi.fn().mockResolvedValue(undefined),
      stopMeeting: vi.fn().mockResolvedValue(undefined)
    }
    const historyService = {
      list: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 }),
      search: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 }),
      get: vi.fn().mockResolvedValue(null),
      delete: vi.fn().mockResolvedValue(false),
      export: vi.fn().mockResolvedValue({ ok: false, error: 'not implemented' })
    }
    const speechService = {
      listProfiles: vi.fn().mockResolvedValue([]),
      testProfile: vi.fn().mockResolvedValue({ ok: true, profileId: 'local-fast' })
    }
    const settingsService = {
      getSettings: vi.fn().mockResolvedValue({
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
      updateSettings: vi.fn().mockResolvedValue(undefined)
    }

    const app = await createApp({
      registrar: {
        handle(channel) {
          registrations.push(channel)
        }
      },
      services: {
        sessionCoordinator,
        speechService,
        historyService,
        settingsService
      },
      windows: {
        browserWindowFactory: ({ title }) => ({
          loadURL: vi.fn(),
          title,
          ...(title === 'JustSay V2'
            ? {
                webContents: {
                  send(channel: string, payload?: unknown) {
                    mainWindowEvents.push({ channel, payload })
                  }
                }
              }
            : {})
        }),
        rendererUrl: 'app://renderer',
        captureUrl: 'app://capture',
        preloadPath: '/abs/preload.js'
      }
    })

    expect(registrations).toEqual([
      'session.getRuntime',
      'session.prewarm',
      'session.startPtt',
      'session.stopPtt',
      'session.startMeeting',
      'session.stopMeeting',
      'speech.listProfiles',
      'speech.testProfile',
      'history.list',
      'history.search',
      'history.get',
      'history.delete',
      'history.export',
      'settings.get',
      'settings.update'
    ])
    expect(app.windows.mainWindow).toBeDefined()
    expect(app.windows.captureWindow).toBeDefined()
    expect(mainWindowEvents).toEqual([
      {
        channel: 'runtime.snapshot',
        payload: {
          ptt: { status: 'idle' },
          liveSession: null,
          services: { localService: 'stopped' }
        }
      },
      {
        channel: 'runtime.snapshot',
        payload: {
          ptt: { status: 'idle' },
          liveSession: null,
          services: { localService: 'stopped' }
        }
      }
    ])
  })
})
