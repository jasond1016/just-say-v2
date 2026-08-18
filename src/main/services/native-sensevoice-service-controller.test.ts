import { describe, expect, it, vi } from 'vitest'
import type { ResolvedLocalServiceConfig } from '../../shared/api-types'
import {
  NativeSenseVoiceServiceController,
  type SpawnedNativeServiceProcess
} from './native-sensevoice-service-controller'

describe('NativeSenseVoiceServiceController', () => {
  it('starts the pinned runtime with CUDA/VAD tuning and reports startup-loaded readiness', async () => {
    const child = createFakeChildProcess()
    const spawn = vi.fn(() => child)
    const fetch = vi.fn(async (url: string) => {
      if (url.endsWith('/v1/models')) {
        return createResponse({
          object: 'list',
          data: [{ id: 'sensevoice-small' }]
        })
      }
      return createResponse({ status: 'ok' })
    })
    const controller = new NativeSenseVoiceServiceController({
      host: '127.0.0.1',
      port: 8040,
      modelIdentifier: 'iic/SenseVoiceSmall',
      servicePath: '/runtime/native',
      binaryPath: '/runtime/native/bin/sensevoice-server',
      modelPath: '/runtime/native/models/sensevoice-small-q8.gguf',
      vadModelPath: '/runtime/native/models/fsmn-vad.gguf',
      gpuLayers: 1,
      threads: 6,
      partialMs: 500,
      spawn,
      fetch,
      fileExists: async () => true
    })

    await controller.start(createTarget())

    expect(spawn).toHaveBeenCalledWith(
      '/runtime/native/bin/sensevoice-server',
      expect.arrayContaining([
        '-m',
        '/runtime/native/models/sensevoice-small-q8.gguf',
        '-vad',
        '/runtime/native/models/fsmn-vad.gguf',
        '-ngl',
        '1',
        '--threads',
        '6',
        '--partial-ms',
        '500',
        '127.0.0.1',
        '8040'
      ]),
      expect.objectContaining({
        cwd: '/runtime/native',
        windowsHide: true
      })
    )
    await expect(
      controller.prewarm(createTarget(), { mode: 'ptt', language: 'auto' })
    ).resolves.toMatchObject({
      ok: true,
      readiness: 'ready',
      runtimeFamilyId: 'sensevoice'
    })

    await controller.stop()
    expect(child.kill).toHaveBeenCalledTimes(1)
  })

  it('fails before spawning when a generated native artifact is missing', async () => {
    const spawn = vi.fn()
    const controller = new NativeSenseVoiceServiceController({
      host: '127.0.0.1',
      port: 8040,
      modelIdentifier: 'iic/SenseVoiceSmall',
      servicePath: '/runtime/native',
      spawn,
      fileExists: async (filePath) => !filePath.endsWith('fsmn-vad.gguf')
    })

    await expect(controller.start(createTarget())).rejects.toThrow(
      'pnpm setup:native-sensevoice'
    )
    expect(spawn).not.toHaveBeenCalled()
  })

  it('rejects an HTTP service that does not identify SenseVoiceSmall', async () => {
    const controller = new NativeSenseVoiceServiceController({
      host: '127.0.0.1',
      port: 8040,
      modelIdentifier: 'iic/SenseVoiceSmall',
      servicePath: '/runtime/native',
      fetch: async (url) =>
        url.endsWith('/health')
          ? createResponse({ status: 'ok' })
          : createResponse({ object: 'list', data: [{ id: 'other-model' }] })
    })

    await expect(controller.healthCheck(createTarget())).resolves.toMatchObject({
      ok: false,
      detail: {
        message: 'Native SenseVoice model identity check failed'
      }
    })
  })
})

function createTarget(): ResolvedLocalServiceConfig {
  return {
    mode: 'managed-local',
    host: '127.0.0.1',
    port: 8040,
    runtimeFamilyId: 'sensevoice',
    modelIdentifier: 'iic/SenseVoiceSmall',
    protocol: 'openai-realtime'
  }
}

function createResponse(body: unknown) {
  return {
    ok: true,
    async json() {
      return body
    }
  }
}

function createFakeChildProcess(): SpawnedNativeServiceProcess & {
  kill: ReturnType<typeof vi.fn>
} {
  const exitListeners: Array<() => void> = []
  const readable = {
    on() {}
  }
  const child = {
    killed: false,
    pid: undefined,
    stdout: readable,
    stderr: readable,
    once(_event: 'exit', listener: () => void) {
      exitListeners.push(listener)
    },
    kill: vi.fn(() => {
      child.killed = true
      for (const listener of exitListeners.splice(0)) {
        listener()
      }
      return true
    })
  }
  return child
}
