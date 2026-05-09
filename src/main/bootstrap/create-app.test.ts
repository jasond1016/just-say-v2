import { describe, expect, it, vi } from 'vitest'

import { createApp } from './create-app'

describe('createApp', () => {
  it('registers IPC handlers and forwards runtime events to the main window', async () => {
    const registrations: string[] = []
    const mainWindowEvents: Array<{ channel: string; payload: unknown }> = []
    const runtimeNotification = {
      level: 'warning' as const,
      message: 'Recovered after a brief engine stall'
    }
    const changedSettings = {
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
    const runtimeSnapshot = {
      ptt: { status: 'idle' as const },
      liveSession: null,
      services: { localService: 'stopped' as const }
    }
    const sessionCoordinator = {
      getRuntimeSnapshot: vi.fn().mockReturnValue(runtimeSnapshot),
      onSnapshot: vi.fn().mockImplementation((listener) => {
        listener(runtimeSnapshot)
        return () => {}
      }),
      onNotification: vi.fn().mockImplementation((listener) => {
        listener(runtimeNotification)
        return () => {}
      }),
      prewarm: vi.fn().mockResolvedValue(undefined),
      startPtt: vi.fn().mockResolvedValue(undefined),
      stopPtt: vi.fn().mockResolvedValue(undefined),
      startMeeting: vi.fn().mockResolvedValue(undefined),
      stopMeeting: vi.fn().mockResolvedValue(undefined),
      copyLiveSession: vi.fn().mockResolvedValue(undefined),
      exportLiveSession: vi.fn().mockResolvedValue({ ok: true, path: 'C:\\exports\\live-session.txt' })
    }
    const historyService = {
      list: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 }),
      search: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 }),
      get: vi.fn().mockResolvedValue(null),
      delete: vi.fn().mockResolvedValue(false),
      copy: vi.fn().mockResolvedValue(undefined),
      export: vi.fn().mockResolvedValue({ ok: false, error: 'not implemented' })
    }
    const speechService = {
      listProfiles: vi.fn().mockResolvedValue([]),
      testProfile: vi.fn().mockResolvedValue({ ok: true, profileId: 'local-fast' })
    }
    const settingsService = {
      getSettings: vi.fn().mockResolvedValue(changedSettings),
      updateSettings: vi.fn().mockResolvedValue(undefined),
      onChanged: vi.fn().mockImplementation((listener) => {
        listener(changedSettings)
        return () => {}
      })
    }
    const diagnosticsService = {
      exportDiagnostics: vi.fn().mockResolvedValue({ ok: true, path: 'C:/tmp/diag.json' })
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
        settingsService,
        diagnosticsService
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
      'session.copyLiveSession',
      'session.exportLiveSession',
      'speech.listProfiles',
      'speech.testProfile',
      'history.list',
      'history.search',
      'history.get',
      'history.delete',
      'history.copy',
      'history.export',
      'settings.get',
      'settings.update',
      'diagnostics.export'
    ])
    expect(app.windows.mainWindow).toBeDefined()
    expect(app.windows.captureWindow).toBeDefined()
    expect(mainWindowEvents).toEqual([
      {
        channel: 'runtime.snapshot',
        payload: runtimeSnapshot
      },
      {
        channel: 'runtime.snapshot',
        payload: runtimeSnapshot
      },
      {
        channel: 'runtime.notification',
        payload: runtimeNotification
      },
      {
        channel: 'settings.changed',
        payload: changedSettings
      }
    ])
  })
})
