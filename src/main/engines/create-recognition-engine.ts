import type { RecognitionEngine } from '../../core/contracts/engine'
import type { ResolvedRuntimeConfig } from '../../shared/api-types'
import type { LocalServiceSupervisor } from '../services/local-service-supervisor'
import { LocalEngineAdapter } from './local-engine-adapter'

export type CreateRecognitionEngineDependencies = {
  localServiceSupervisor: LocalServiceSupervisor
}

export function createRecognitionEngine(
  config: ResolvedRuntimeConfig,
  dependencies: CreateRecognitionEngineDependencies
): RecognitionEngine {
  if (config.engineProfile.kind === 'local') {
    return new LocalEngineAdapter(config, {
      ensureLocalServiceReady: () => dependencies.localServiceSupervisor.ensureReady()
    })
  }

  return createUnsupportedEngine(
    `Cloud profile "${config.engineProfile.id}" is not implemented yet`
  )
}

function createUnsupportedEngine(message: string): RecognitionEngine {
  const error = createUnsupportedEngineError(message)

  return {
    async getCapabilities() {
      throw error
    },
    async warmup() {
      throw error
    },
    async startSession() {
      throw error
    },
    pushAudio() {},
    async stopSession() {},
    async abortSession() {},
    onEvent() {
      return () => {}
    }
  }
}

function createUnsupportedEngineError(message: string): Error {
  const error = new Error(message)
  ;(error as Error & { payload?: { code: string; message: string; retryable: boolean } }).payload = {
    code: 'E_ENGINE_UNAVAILABLE',
    message,
    retryable: false
  }
  return error
}
