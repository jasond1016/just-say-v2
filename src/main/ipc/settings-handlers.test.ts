import { describe, expect, it, vi } from 'vitest'

import { IPC_CHANNELS } from './channels'
import { createSettingsHandlers } from './settings-handlers'

describe('createSettingsHandlers', () => {
  it('maps settings IPC channels to the settings service', async () => {
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
      updateSettings: vi.fn().mockResolvedValue({
        general: {
          language: 'en-US',
          theme: 'light',
          launchAtLogin: false,
          minimizeToTray: true
        }
      })
    }

    const handlers = createSettingsHandlers(settingsService)

    await handlers[IPC_CHANNELS.settingsGet]()
    await handlers[IPC_CHANNELS.settingsUpdate]({
      general: {
        language: 'en-US',
        theme: 'light'
      }
    })

    expect(settingsService.getSettings).toHaveBeenCalled()
    expect(settingsService.updateSettings).toHaveBeenCalledWith({
      general: {
        language: 'en-US',
        theme: 'light'
      }
    })
  })
})
