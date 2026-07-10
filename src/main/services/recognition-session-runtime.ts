import type {
  RecognitionEngine,
  RecognitionEvent,
  StartSessionInput,
  WarmupInput
} from '../../core/contracts/engine'
import type { AppErrorPayload, ResolvedRuntimeConfig } from '../../shared/api-types'
import type { CaptureSource, SessionMode } from '../../shared/primitive-types'
import type { CaptureWindowService } from '../platform/capture-window-service'

export type StartRecognitionSessionInput = {
  engine: RecognitionEngine
  captureWindowService: CaptureWindowService
  sessionId: string
  mode: SessionMode
  sources: CaptureSource[]
  runtimeConfig: ResolvedRuntimeConfig
  microphoneDeviceId?: string
  explicitWarmup?: boolean
  startCapture?: boolean
}

export type AbortRecognitionSessionInput = {
  engine?: RecognitionEngine | null
  captureWindowService: CaptureWindowService
  sessionId?: string
  abortCapture?: boolean
}

export function attachRecognitionEngine(
  engine: RecognitionEngine,
  onEvent: (event: RecognitionEvent) => void | Promise<void>
): () => void {
  return engine.onEvent((event) => {
    void onEvent(event)
  })
}

export function buildStartSessionInput(input: {
  sessionId: string
  mode: SessionMode
  sources: CaptureSource[]
  runtimeConfig: ResolvedRuntimeConfig
}): StartSessionInput {
  const { sessionId, mode, sources, runtimeConfig } = input
  const translationConfig = runtimeConfig.translationConfig

  return {
    sessionId,
    mode,
    sources,
    language: String(runtimeConfig.engineConfig.language),
    translation: {
      enabled: Boolean(translationConfig) && runtimeConfig.engineProfile.capabilities.translation,
      ...(translationConfig
        ? {
            targetLanguage: String(translationConfig.targetLanguage)
          }
        : {})
    }
  }
}

export async function startRecognitionSession(input: StartRecognitionSessionInput): Promise<void> {
  const {
    engine,
    captureWindowService,
    sessionId,
    mode,
    sources,
    runtimeConfig,
    microphoneDeviceId,
    explicitWarmup = false,
    startCapture = true
  } = input
  const warmupInput: WarmupInput = {
    mode,
    language: String(runtimeConfig.engineConfig.language)
  }

  if (explicitWarmup) {
    await engine.warmup(warmupInput)
  }

  await engine.startSession(
    buildStartSessionInput({
      sessionId,
      mode,
      sources,
      runtimeConfig
    })
  )

  if (!startCapture) {
    return
  }

  await captureWindowService.startCapture({
    requestId: sessionId,
    sources,
    ...(microphoneDeviceId ? { microphoneDeviceId } : {}),
    sampleRate: runtimeConfig.captureConfig.sampleRate,
    chunkMs: runtimeConfig.captureConfig.chunkMs
  })
}

export async function stopRecognitionCapture(
  captureWindowService: CaptureWindowService,
  sessionId: string
): Promise<boolean> {
  return captureWindowService.stopCapture(sessionId)
}

export async function abortRecognitionSession(input: AbortRecognitionSessionInput): Promise<void> {
  const { engine, captureWindowService, sessionId, abortCapture = true } = input

  try {
    await engine?.abortSession()
  } catch {
    // best effort cleanup
  }

  if (!abortCapture) {
    return
  }

  try {
    await captureWindowService.abortCapture(sessionId)
  } catch {
    // best effort cleanup
  }
}

export function normalizeRecognitionError(
  errorLike: unknown,
  fallbackMessage = 'Unknown recognition session error'
): AppErrorPayload {
  if (isAppErrorPayload(errorLike)) {
    return errorLike
  }

  if (errorLike instanceof Error) {
    const payload = (errorLike as Error & { payload?: AppErrorPayload }).payload

    if (payload && isAppErrorPayload(payload)) {
      return payload
    }

    return {
      code: 'E_ENGINE_PROTOCOL',
      message: errorLike.message,
      retryable: true
    }
  }

  if (errorLike && typeof errorLike === 'object') {
    const candidate = errorLike as Partial<AppErrorPayload>
    if (
      typeof candidate.code === 'string' &&
      typeof candidate.message === 'string' &&
      typeof candidate.retryable === 'boolean'
    ) {
      return candidate as AppErrorPayload
    }
  }

  return {
    code: 'E_ENGINE_PROTOCOL',
    message: fallbackMessage,
    retryable: true
  }
}

function isAppErrorPayload(value: unknown): value is AppErrorPayload {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Partial<AppErrorPayload>
  return (
    typeof candidate.code === 'string' &&
    typeof candidate.message === 'string' &&
    typeof candidate.retryable === 'boolean'
  )
}
