import { describe, expect, it, vi } from 'vitest'

import type { ResolvedLocalServiceConfig, RuntimeReadiness } from '../../shared/api-types'
import type { LocalServiceController } from './local-service-supervisor'
import { LocalServiceSupervisor } from './local-service-supervisor'
import { establishRuntimeReadiness } from './runtime-readiness'

describe('establishRuntimeReadiness', () => {
  it('session-start ensures readiness, prewarms, and rejects identity mismatch', async () => {
    const prewarm = vi.fn(async (target) => ({
      ok: true,
      runtimeFamilyId: 'qwen3-asr' as const,
      modelIdentifier: 'wrong-model',
      readiness: 'ready' as const
    }))
    const supervisor = createSupervisor({ prewarm })

    await expect(
      establishRuntimeReadiness(
        { supervisor },
        createInput({
          intent: 'session-start',
          runtimeFamilyId: 'sensevoice',
          expectedIdentity: {
            runtimeFamilyId: 'sensevoice',
            modelIdentifier: 'iic/SenseVoiceSmall'
          }
        })
      )
    ).rejects.toThrow(/does not match service runtime/)

    expect(prewarm).toHaveBeenCalledTimes(1)
  })

  it('profile-check skips prewarm while qwen is warming', async () => {
    const prewarm = vi.fn()
    const supervisor = createSupervisor({
      healthReadiness: 'warming',
      prewarm
    })

    const result = await establishRuntimeReadiness(
      { supervisor },
      createInput({
        intent: 'profile-check',
        runtimeFamilyId: 'qwen3-asr',
        expectedIdentity: {
          runtimeFamilyId: 'qwen3-asr',
          modelIdentifier: 'Qwen3-ASR'
        }
      })
    )

    expect(result).toMatchObject({
      prewarmTriggered: false,
      identityMismatch: false,
      health: {
        readiness: 'warming'
      }
    })
    expect(prewarm).not.toHaveBeenCalled()
  })

  it('profile-check prewarms qwen when prewarm is required', async () => {
    const prewarm = vi.fn(async (target) => ({
      ok: true,
      runtimeFamilyId: target.runtimeFamilyId,
      modelIdentifier: target.modelIdentifier,
      readiness: 'ready' as const
    }))
    const supervisor = createSupervisor({
      healthReadiness: 'prewarm-required',
      prewarm
    })

    const result = await establishRuntimeReadiness(
      { supervisor },
      createInput({
        intent: 'profile-check',
        runtimeFamilyId: 'qwen3-asr',
        expectedIdentity: {
          runtimeFamilyId: 'qwen3-asr',
          modelIdentifier: 'Qwen3-ASR'
        }
      })
    )

    expect(result).toMatchObject({
      prewarmTriggered: true,
      identityMismatch: false,
      health: {
        readiness: 'ready'
      }
    })
    expect(prewarm).toHaveBeenCalledTimes(1)
  })

  it('profile-check prewarms non-qwen runtimes when they are not ready', async () => {
    const prewarm = vi.fn(async (target) => ({
      ok: true,
      runtimeFamilyId: target.runtimeFamilyId,
      modelIdentifier: target.modelIdentifier,
      readiness: 'ready' as const
    }))
    const supervisor = createSupervisor({
      healthReadiness: 'prewarm-required',
      prewarm
    })

    const result = await establishRuntimeReadiness(
      { supervisor },
      createInput({
        intent: 'profile-check',
        runtimeFamilyId: 'sensevoice',
        expectedIdentity: {
          runtimeFamilyId: 'sensevoice',
          modelIdentifier: 'iic/SenseVoiceSmall'
        }
      })
    )

    expect(result).toMatchObject({
      prewarmTriggered: true,
      identityMismatch: false
    })
    expect(prewarm).toHaveBeenCalledTimes(1)
  })

  it('profile-check reports identity mismatch without prewarming', async () => {
    const prewarm = vi.fn()
    const supervisor = createSupervisor({
      healthReadiness: 'prewarm-required',
      healthIdentity: {
        runtimeFamilyId: 'qwen3-asr',
        modelIdentifier: 'Qwen3-ASR'
      },
      prewarm
    })

    const result = await establishRuntimeReadiness(
      { supervisor },
      createInput({
        intent: 'profile-check',
        runtimeFamilyId: 'sensevoice',
        expectedIdentity: {
          runtimeFamilyId: 'sensevoice',
          modelIdentifier: 'iic/SenseVoiceSmall'
        }
      })
    )

    expect(result).toMatchObject({
      prewarmTriggered: false,
      identityMismatch: true
    })
    expect(prewarm).not.toHaveBeenCalled()
  })
})

function createInput(
  overrides: Partial<{
    intent: 'profile-check' | 'session-start'
    runtimeFamilyId: string
    expectedIdentity: {
      runtimeFamilyId: ResolvedLocalServiceConfig['runtimeFamilyId']
      modelIdentifier: string
    }
  }>
) {
  const target = createTarget(overrides.expectedIdentity ?? {
    runtimeFamilyId: 'sensevoice',
    modelIdentifier: 'iic/SenseVoiceSmall'
  })

  return {
    target,
    runtimeFamilyId: overrides.runtimeFamilyId ?? target.runtimeFamilyId,
    expectedIdentity: overrides.expectedIdentity ?? {
      runtimeFamilyId: target.runtimeFamilyId,
      modelIdentifier: target.modelIdentifier
    },
    mode: 'meeting' as const,
    language: 'auto',
    intent: overrides.intent ?? 'profile-check'
  }
}

function createTarget(identity: {
  runtimeFamilyId: ResolvedLocalServiceConfig['runtimeFamilyId']
  modelIdentifier: string
}): ResolvedLocalServiceConfig {
  return {
    mode: 'managed-local',
    host: '127.0.0.1',
    port: 8765,
    runtimeFamilyId: identity.runtimeFamilyId,
    modelIdentifier: identity.modelIdentifier
  }
}

function createSupervisor(overrides: {
  healthReadiness?: RuntimeReadiness
  healthIdentity?: {
    runtimeFamilyId: ResolvedLocalServiceConfig['runtimeFamilyId']
    modelIdentifier: string
  }
  prewarm?: LocalServiceController['prewarm']
} = {}): LocalServiceSupervisor {
  return new LocalServiceSupervisor({
    async start() {},
    async stop() {},
    async healthCheck(target) {
      return {
        ok: true,
        runtimeFamilyId: overrides.healthIdentity?.runtimeFamilyId ?? target.runtimeFamilyId,
        modelIdentifier: overrides.healthIdentity?.modelIdentifier ?? target.modelIdentifier,
        readiness: overrides.healthReadiness ?? 'ready'
      }
    },
    async prewarm(target, input) {
      if (overrides.prewarm) {
        return overrides.prewarm(target, input)
      }

      return {
        ok: true,
        runtimeFamilyId: target.runtimeFamilyId,
        modelIdentifier: target.modelIdentifier,
        readiness: 'ready'
      }
    }
  })
}
