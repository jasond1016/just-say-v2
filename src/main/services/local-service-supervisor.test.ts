import { describe, expect, it } from 'vitest'

import { LocalServiceSupervisor } from './local-service-supervisor'
import type { ResolvedLocalServiceConfig } from '../../shared/api-types'

describe('LocalServiceSupervisor', () => {
  it('starts the local service and marks it healthy', async () => {
    const controller = new FakeLocalServiceController({
      health: { ok: true }
    })
    const supervisor = new LocalServiceSupervisor(controller)
    const seenStatuses: string[] = []
    supervisor.onStatusChange((status) => {
      seenStatuses.push(status)
    })

    await expect(supervisor.ensureReady(createTarget())).resolves.toBe('healthy')

    expect(supervisor.getStatus()).toBe('healthy')
    expect(controller.startCalls).toBe(1)
    expect(controller.healthCheckCalls).toBe(1)
    expect(seenStatuses).toEqual(['starting', 'healthy'])
  })

  it('marks the local service degraded when health check is degraded', async () => {
    const controller = new FakeLocalServiceController({
      health: { ok: true, degraded: true }
    })
    const supervisor = new LocalServiceSupervisor(controller)

    await expect(supervisor.ensureReady(createTarget())).resolves.toBe('degraded')
    expect(supervisor.getStatus()).toBe('degraded')
  })

  it('fails when the local service cannot start', async () => {
    const controller = new FakeLocalServiceController({
      startFailure: new Error('Port is already in use')
    })
    const supervisor = new LocalServiceSupervisor(controller)

    await expect(supervisor.ensureReady(createTarget())).rejects.toMatchObject({
      code: 'E_LOCAL_SERVICE_START',
      message: 'Port is already in use'
    })
    expect(supervisor.getStatus()).toBe('failed')
  })

  it('restarts the local service by stopping and starting it again', async () => {
    const controller = new FakeLocalServiceController({
      health: { ok: true }
    })
    const supervisor = new LocalServiceSupervisor(controller)

    await supervisor.ensureReady(createTarget())
    await expect(supervisor.restart(createTarget())).resolves.toBe('healthy')

    expect(controller.startCalls).toBe(2)
    expect(controller.stopCalls).toBe(1)
  })

  it('probes an already running local service without starting it', async () => {
    const controller = new FakeLocalServiceController({
      health: { ok: true }
    })
    const supervisor = new LocalServiceSupervisor(controller)

    await expect(supervisor.probe(createTarget())).resolves.toBe('healthy')

    expect(supervisor.getStatus()).toBe('healthy')
    expect(controller.startCalls).toBe(0)
    expect(controller.healthCheckCalls).toBe(1)
  })

  it('marks the local service stopped when probing cannot reach it', async () => {
    const controller = new FakeLocalServiceController({
      healthFailure: new Error('connect ECONNREFUSED 127.0.0.1:8765')
    })
    const supervisor = new LocalServiceSupervisor(controller)

    await expect(supervisor.probe(createTarget())).resolves.toBe('stopped')

    expect(supervisor.getStatus()).toBe('stopped')
    expect(controller.startCalls).toBe(0)
    expect(controller.healthCheckCalls).toBe(1)
  })
})

class FakeLocalServiceController {
  startCalls = 0
  stopCalls = 0
  healthCheckCalls = 0

  constructor(
    private readonly options: {
      health: { ok: boolean; degraded?: boolean }
      startFailure?: Error
      healthFailure?: Error
    } | {
      startFailure: Error
      health?: { ok: boolean; degraded?: boolean }
      healthFailure?: Error
    } | {
      healthFailure: Error
      health?: { ok: boolean; degraded?: boolean }
      startFailure?: Error
    }
  ) {}

  async start(_target: ResolvedLocalServiceConfig): Promise<void> {
    this.startCalls += 1

    if (this.options.startFailure) {
      throw this.options.startFailure
    }
  }

  async stop(): Promise<void> {
    this.stopCalls += 1
  }

  async healthCheck(target: ResolvedLocalServiceConfig) {
    this.healthCheckCalls += 1

    if (this.options.healthFailure) {
      throw this.options.healthFailure
    }

    return {
      ok: this.options.health?.ok ?? true,
      runtimeFamilyId: target.runtimeFamilyId,
      modelIdentifier: target.modelIdentifier,
      readiness: 'ready' as const,
      ...(this.options.health?.degraded ? { degraded: true } : {})
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

function createTarget(): ResolvedLocalServiceConfig {
  return {
    mode: 'managed-local',
    host: '127.0.0.1',
    port: 8765,
    runtimeFamilyId: 'sensevoice',
    modelIdentifier: 'iic/SenseVoiceSmall'
  }
}
