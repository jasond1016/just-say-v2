import type { RecognitionEngine } from '../../core/contracts/engine'
import type { ResolvedRuntimeConfig } from '../../shared/api-types'
import type { CaptureSource, SessionMode } from '../../shared/primitive-types'
import type {
  RecognitionSessionBridge,
  RecognitionSessionHandlers
} from './recognition-session-bridge'

export type PrepareRecognitionSessionSettingsProvider = {
  resolveRuntimeConfig(mode: SessionMode): ResolvedRuntimeConfig
}

export type PrepareRecognitionSessionStartInput = {
  sources: CaptureSource[]
  microphoneDeviceId?: string
  explicitWarmup?: boolean
  startCapture?: boolean
}

export type PrepareRecognitionSessionInput = {
  recognitionSession: RecognitionSessionBridge
  settingsProvider: PrepareRecognitionSessionSettingsProvider
  engineFactory: (config: ResolvedRuntimeConfig) => RecognitionEngine
  mode: SessionMode
  sessionId: string
  handlers: RecognitionSessionHandlers
  start: PrepareRecognitionSessionStartInput
  adaptRuntimeConfig?: (config: ResolvedRuntimeConfig) => ResolvedRuntimeConfig
  /**
   * Mode-specific session construction runs here after resolve+factory and
   * before Bridge.bind/start, so handlers can see an active session.
   */
  onPrepared?: (prepared: {
    runtimeConfig: ResolvedRuntimeConfig
    engine: RecognitionEngine
  }) => void | Promise<void>
}

export type PrepareRecognitionSessionResult = {
  runtimeConfig: ResolvedRuntimeConfig
  engine: RecognitionEngine
}

/**
 * Shared Recognition Session prepare recipe: resolve Runtime Settings → engine →
 * Bridge.bind → Bridge.start. Not an effect owner (ADR-0002); coordinators keep
 * their SessionDispatchLoop and mode-specific policy.
 */
export async function prepareRecognitionSession(
  input: PrepareRecognitionSessionInput
): Promise<PrepareRecognitionSessionResult> {
  const resolved = input.settingsProvider.resolveRuntimeConfig(input.mode)
  const runtimeConfig = input.adaptRuntimeConfig
    ? input.adaptRuntimeConfig(resolved)
    : resolved
  const engine = input.engineFactory(runtimeConfig)

  await input.onPrepared?.({ runtimeConfig, engine })

  input.recognitionSession.bind({
    engine,
    sessionId: input.sessionId,
    handlers: input.handlers
  })

  await input.recognitionSession.start({
    mode: input.mode,
    sources: input.start.sources,
    runtimeConfig,
    ...(input.start.microphoneDeviceId !== undefined
      ? { microphoneDeviceId: input.start.microphoneDeviceId }
      : {}),
    ...(input.start.explicitWarmup !== undefined
      ? { explicitWarmup: input.start.explicitWarmup }
      : {}),
    ...(input.start.startCapture !== undefined
      ? { startCapture: input.start.startCapture }
      : {})
  })

  return { runtimeConfig, engine }
}
