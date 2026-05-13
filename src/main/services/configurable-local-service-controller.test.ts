import { describe, expect, it } from 'vitest'
import type { AppSettings } from '../../shared/api-types'
import {
  ConfigurableLocalServiceController,
  resolveLocalServiceControllerConfig
} from './configurable-local-service-controller'
import type { LocalServiceController } from './local-service-supervisor'

describe('resolveLocalServiceControllerConfig', () => {
  it('defaults to a managed local service config', () => {
    expect(resolveLocalServiceControllerConfig(createSettings())).toEqual({
      mode: 'managed-local',
      host: '127.0.0.1',
      port: 8765
    })
  })

  it('returns an invalid config when remote mode is missing a host', () => {
    expect(
      resolveLocalServiceControllerConfig({
        ...createSettings(),
        advanced: {
          ...createSettings().advanced,
          localServiceMode: 'remote-service'
        }
      })
    ).toMatchObject({
      mode: 'invalid',
      error: {
        code: 'E_INVALID_SETTINGS'
      }
    })
  })
})

describe('ConfigurableLocalServiceController', () => {
  it('switches from a managed controller to a remote controller when settings change', async () => {
    let settings = createSettings()
    const managedControllers: FakeLocalServiceController[] = []
    const remoteControllers: FakeLocalServiceController[] = []
    const controller = new ConfigurableLocalServiceController({
      getSettings: () => settings,
      localServicePath: 'C:\\local-service',
      createManagedController(config) {
        const fake = new FakeLocalServiceController(config)
        managedControllers.push(fake)
        return fake
      },
      createRemoteController(config) {
        const fake = new FakeLocalServiceController(config)
        remoteControllers.push(fake)
        return fake
      }
    })

    await controller.start()
    await expect(controller.healthCheck()).resolves.toEqual({ ok: true })

    settings = {
      ...settings,
      advanced: {
        ...settings.advanced,
        localServiceMode: 'remote-service',
        remoteServiceHost: '10.0.0.42'
      }
    }

    await controller.start()
    await expect(controller.healthCheck()).resolves.toEqual({ ok: true })

    expect(managedControllers).toHaveLength(1)
    expect(managedControllers[0]?.startCalls).toBe(1)
    expect(managedControllers[0]?.stopCalls).toBe(1)
    expect(remoteControllers).toHaveLength(1)
    expect(remoteControllers[0]?.startCalls).toBe(1)
  })

  it('surfaces a structured error when remote mode is enabled without a host', async () => {
    const controller = new ConfigurableLocalServiceController({
      getSettings: () => ({
        ...createSettings(),
        advanced: {
          ...createSettings().advanced,
          localServiceMode: 'remote-service'
        }
      }),
      localServicePath: 'C:\\local-service'
    })

    await expect(controller.start()).rejects.toMatchObject({
      code: 'E_INVALID_SETTINGS',
      message: 'Remote speech service host is required when remote service mode is enabled'
    })
  })
})

class FakeLocalServiceController implements LocalServiceController {
  startCalls = 0
  stopCalls = 0
  healthCheckCalls = 0

  constructor(readonly config: { mode: 'managed-local' | 'remote-service'; host: string; port: number }) {}

  async start(): Promise<void> {
    this.startCalls += 1
  }

  async stop(): Promise<void> {
    this.stopCalls += 1
  }

  async healthCheck() {
    this.healthCheckCalls += 1
    return { ok: true }
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
      localServiceMode: 'managed-local',
      diagnosticsEnabled: true,
      experimentalFlags: []
    }
  }
}
