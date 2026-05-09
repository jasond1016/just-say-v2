import { describe, expect, it } from 'vitest'

import { LocalServiceSupervisor } from './local-service-supervisor'

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

    await expect(supervisor.ensureReady()).resolves.toBe('healthy')

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

    await expect(supervisor.ensureReady()).resolves.toBe('degraded')
    expect(supervisor.getStatus()).toBe('degraded')
  })

  it('fails when the local service cannot start', async () => {
    const controller = new FakeLocalServiceController({
      startFailure: new Error('Port is already in use')
    })
    const supervisor = new LocalServiceSupervisor(controller)

    await expect(supervisor.ensureReady()).rejects.toMatchObject({
      code: 'E_LOCAL_SERVICE_START',
      message: 'Port is already in use'
    })
    expect(supervisor.getStatus()).toBe('failed')
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
    } | {
      startFailure: Error
      health?: { ok: boolean; degraded?: boolean }
    }
  ) {}

  async start(): Promise<void> {
    this.startCalls += 1

    if (this.options.startFailure) {
      throw this.options.startFailure
    }
  }

  async stop(): Promise<void> {
    this.stopCalls += 1
  }

  async healthCheck(): Promise<{ ok: boolean; degraded?: boolean }> {
    this.healthCheckCalls += 1
    return this.options.health ?? { ok: true }
  }
}
