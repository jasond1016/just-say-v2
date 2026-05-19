import { describe, expect, it } from 'vitest'
import type { ResolvedLocalServiceConfig } from '../../shared/api-types'
import {
  ConfigurableLocalServiceController,
  resolveLocalServiceControllerConfig
} from './configurable-local-service-controller'
import type { LocalServiceController } from './local-service-supervisor'

describe('resolveLocalServiceControllerConfig', () => {
  it('defaults to a managed local service config', () => {
    expect(resolveLocalServiceControllerConfig(createManagedTarget(), createManagedRuntimePaths())).toEqual({
      mode: 'managed-local',
      host: '127.0.0.1',
      port: 8765,
      runtimeFamilyId: 'sensevoice',
      modelIdentifier: 'iic/SenseVoiceSmall',
      servicePath: 'C:\\local-service'
    })
  })

  it('returns an invalid config when no managed runtime path exists for the target runtime', () => {
    expect(
      resolveLocalServiceControllerConfig(
        createManagedTarget({ runtimeFamilyId: 'qwen3-asr' }),
        { sensevoice: 'C:\\local-service' } as unknown as ReturnType<typeof createManagedRuntimePaths>
      )
    ).toMatchObject({
      mode: 'invalid',
      error: {
        code: 'E_ENGINE_UNAVAILABLE'
      }
    })
  })
})

describe('ConfigurableLocalServiceController', () => {
  it('switches from a managed controller to a remote controller when settings change', async () => {
    let target = createManagedTarget()
    const managedControllers: FakeLocalServiceController[] = []
    const remoteControllers: FakeLocalServiceController[] = []
    const controller = new ConfigurableLocalServiceController({
      managedRuntimePaths: createManagedRuntimePaths(),
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

    await controller.start(target)
    await expect(controller.healthCheck(target)).resolves.toMatchObject({ ok: true, readiness: 'ready' })

    target = createRemoteTarget()

    await controller.start(target)
    await expect(controller.healthCheck(target)).resolves.toMatchObject({ ok: true, readiness: 'ready' })

    expect(managedControllers).toHaveLength(1)
    expect(managedControllers[0]?.startCalls).toBe(1)
    expect(managedControllers[0]?.stopCalls).toBe(1)
    expect(remoteControllers).toHaveLength(1)
    expect(remoteControllers[0]?.startCalls).toBe(1)
  })

  it('surfaces a structured error when remote mode is enabled without a host', async () => {
    const controller = new ConfigurableLocalServiceController({
      managedRuntimePaths: {
        sensevoice: 'C:\\local-service'
      } as unknown as ReturnType<typeof createManagedRuntimePaths>
    })

    await expect(controller.start(createManagedTarget({ runtimeFamilyId: 'qwen3-asr' }))).rejects.toMatchObject({
      code: 'E_ENGINE_UNAVAILABLE'
    })
  })
})

class FakeLocalServiceController implements LocalServiceController {
  startCalls = 0
  stopCalls = 0
  healthCheckCalls = 0

  constructor(
    readonly config:
      | {
          mode: 'managed-local'
          host: string
          port: number
          runtimeFamilyId: 'sensevoice' | 'qwen3-asr'
          modelIdentifier: string
          servicePath: string
        }
      | {
          mode: 'remote-service'
          host: string
          port: number
          runtimeFamilyId: 'sensevoice' | 'qwen3-asr'
          modelIdentifier: string
        }
  ) {}

  async start(_target: ResolvedLocalServiceConfig): Promise<void> {
    this.startCalls += 1
  }

  async stop(): Promise<void> {
    this.stopCalls += 1
  }

  async healthCheck(target: ResolvedLocalServiceConfig) {
    this.healthCheckCalls += 1
    return {
      ok: true,
      runtimeFamilyId: target.runtimeFamilyId,
      modelIdentifier: target.modelIdentifier,
      readiness: 'ready' as const
    }
  }

  async prewarm(target: ResolvedLocalServiceConfig) {
    return {
      ok: true,
      runtimeFamilyId: target.runtimeFamilyId,
      modelIdentifier: target.modelIdentifier,
      readiness: 'ready' as const
    }
  }
}

function createManagedRuntimePaths() {
  return {
    sensevoice: 'C:\\local-service',
    'qwen3-asr': 'C:\\qwen-local-service'
  } as const
}

function createManagedTarget(
  overrides: Partial<ResolvedLocalServiceConfig> = {}
): ResolvedLocalServiceConfig {
  return {
    mode: 'managed-local',
    host: '127.0.0.1',
    port: 8765,
    runtimeFamilyId: 'sensevoice',
    modelIdentifier: 'iic/SenseVoiceSmall',
    ...overrides
  }
}

function createRemoteTarget(): ResolvedLocalServiceConfig {
  return {
    mode: 'remote-service',
    host: '10.0.0.42',
    port: 8765,
    runtimeFamilyId: 'sensevoice',
    modelIdentifier: 'iic/SenseVoiceSmall'
  }
}
