import type { ResolvedLocalServiceConfig, RuntimeIdentity } from '../../shared/api-types'
import type { SessionMode } from '../../shared/primitive-types'
import type { LocalServiceHealthResult, LocalServiceSupervisor } from './local-service-supervisor'

export type RuntimeReadinessIntent = 'profile-check' | 'session-start'

export type EstablishRuntimeReadinessInput = {
  target: ResolvedLocalServiceConfig
  runtimeFamilyId: string
  expectedIdentity: RuntimeIdentity
  mode: SessionMode
  language: string
  intent: RuntimeReadinessIntent
}

export type RuntimeReadinessEstablishmentResult = {
  health: LocalServiceHealthResult
  prewarmTriggered: boolean
  identityMismatch: boolean
}

export async function establishRuntimeReadiness(
  deps: { supervisor: LocalServiceSupervisor },
  input: EstablishRuntimeReadinessInput
): Promise<RuntimeReadinessEstablishmentResult> {
  const { supervisor } = deps
  const { target, runtimeFamilyId, expectedIdentity, mode, language, intent } = input

  if (intent === 'session-start') {
    await supervisor.ensureReady(target)
    const health = await supervisor.prewarm(target, { mode, language })

    if (!identityMatches(health, expectedIdentity)) {
      throw createIdentityMismatchError(expectedIdentity, health)
    }

    if (!health.ok) {
      throw new Error('Local service reported unhealthy during prewarm')
    }

    return {
      health,
      prewarmTriggered: true,
      identityMismatch: false
    }
  }

  let health = await supervisor.checkHealth(target)
  let prewarmTriggered = false

  if (identityMatches(health, expectedIdentity)) {
    if (runtimeFamilyId === 'qwen3-asr') {
      if (health.readiness === 'prewarm-required') {
        health = await supervisor.prewarm(target, { mode, language })
        prewarmTriggered = true
      }
    } else if (health.readiness !== 'ready') {
      health = await supervisor.prewarm(target, { mode, language })
      prewarmTriggered = true
    }
  }

  return {
    health,
    prewarmTriggered,
    identityMismatch: !identityMatches(health, expectedIdentity)
  }
}

function identityMatches(health: LocalServiceHealthResult, expected: RuntimeIdentity): boolean {
  return (
    health.runtimeFamilyId === expected.runtimeFamilyId &&
    health.modelIdentifier === expected.modelIdentifier
  )
}

function createIdentityMismatchError(
  expected: RuntimeIdentity,
  actual: Pick<LocalServiceHealthResult, 'runtimeFamilyId' | 'modelIdentifier'>
): Error {
  return new Error(
    `Configured runtime "${expected.runtimeFamilyId}" does not match service runtime ` +
      `"${actual.runtimeFamilyId}" (${actual.modelIdentifier})`
  )
}

export function createIdentityMismatchAppError(
  expected: RuntimeIdentity,
  actual: Pick<LocalServiceHealthResult, 'runtimeFamilyId' | 'modelIdentifier'>
) {
  return {
    code: 'E_ENGINE_UNAVAILABLE' as const,
    message: createIdentityMismatchError(expected, actual).message,
    retryable: false
  }
}
