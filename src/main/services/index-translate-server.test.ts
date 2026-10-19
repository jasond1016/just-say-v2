import { describe, expect, it, vi } from 'vitest'

import { DEFAULT_SETTINGS } from '../../core/settings/settings-schema'
import {
  IndexTranslateServer,
  resolveIndexTranslateLaunch,
  shouldRunIndexTranslate,
  type SpawnedIndexTranslateProcess
} from './index-translate-server'

describe('resolveIndexTranslateLaunch', () => {
  it('uses the experiment paths when both files exist', () => {
    const launch = resolveIndexTranslateLaunch('D:\\repo', {}, (filePath) => filePath.endsWith('gguf') || filePath.endsWith('llama-server.exe'))

    expect(launch).toMatchObject({
      port: 8088,
      endpoint: 'http://127.0.0.1:8088/v1',
      modelPath: 'D:\\repo\\.amp\\in\\mt\\index-translate-2b\\models\\Index-Translate-2B.Q4_K_M.gguf',
      serverPath: 'D:\\repo\\.amp\\in\\mt\\index-translate-2b\\bin\\llama\\llama-server.exe'
    })
    expect(launch).not.toHaveProperty('model')
  })

  it('returns nothing when the weights are missing', () => {
    expect(resolveIndexTranslateLaunch('D:\\repo', {}, () => false)).toBeUndefined()
  })

  it('honors environment overrides', () => {
    const launch = resolveIndexTranslateLaunch(
      'D:\\repo',
      {
        JUSTSAY_INDEX_TRANSLATE_MODEL: 'D:\\models\\custom.gguf',
        JUSTSAY_INDEX_TRANSLATE_SERVER: 'D:\\bin\\llama-server.exe',
        JUSTSAY_INDEX_TRANSLATE_PORT: '8090'
      },
      () => true
    )

    expect(launch).toMatchObject({
      modelPath: 'D:\\models\\custom.gguf',
      serverPath: 'D:\\bin\\llama-server.exe',
      port: 8090,
      endpoint: 'http://127.0.0.1:8090/v1'
    })
  })
})

describe('shouldRunIndexTranslate', () => {
  it('starts only when Index-Translate is the provider and a mode is enabled', () => {
    expect(shouldRunIndexTranslate(DEFAULT_SETTINGS)).toBe(false)
    expect(
      shouldRunIndexTranslate({
        ...DEFAULT_SETTINGS,
        translation: {
          ...DEFAULT_SETTINGS.translation,
          enabledForPtt: true
        }
      })
    ).toBe(true)
    expect(
      shouldRunIndexTranslate({
        ...DEFAULT_SETTINGS,
        translation: {
          ...DEFAULT_SETTINGS.translation,
          provider: 'openai-compatible',
          enabledForPtt: true
        }
      })
    ).toBe(false)
    expect(
      shouldRunIndexTranslate({
        ...DEFAULT_SETTINGS,
        translation: {
          ...DEFAULT_SETTINGS.translation,
          enabledForPtt: true,
          deployment: 'remote-service',
          remoteHost: '10.0.0.8'
        }
      })
    ).toBe(false)
  })
})

describe('IndexTranslateServer', () => {
  it('spawns llama-server with reasoning off and a capped context', async () => {
    const child = fakeChild()
    const spawn = vi.fn(() => child)
    let healthy = false
    const server = new IndexTranslateServer({
      launch: {
        serverPath: 'D:\\bin\\llama-server.exe',
        modelPath: 'D:\\models\\Index-Translate-2B.Q4_K_M.gguf',
        bindHost: '127.0.0.1',
        port: 8088,
        endpoint: 'http://127.0.0.1:8088/v1'
      },
      spawn,
      fetchFn: (async () => ({ ok: healthy })) as unknown as typeof fetch,
      pollIntervalMs: 1,
      healthTimeoutMs: 1_000
    })

    const starting = server.start()
    await vi.waitFor(() => {
      expect(spawn).toHaveBeenCalled()
    })
    healthy = true
    await starting

    expect(spawn).toHaveBeenCalledWith(
      'D:\\bin\\llama-server.exe',
      [
        '-m',
        'D:\\models\\Index-Translate-2B.Q4_K_M.gguf',
        '-c',
        '4096',
        '-ngl',
        '99',
        '--host',
        '127.0.0.1',
        '--port',
        '8088',
        '--reasoning',
        'off',
        '-fa',
        'on'
      ],
      expect.objectContaining({
        cwd: 'D:\\bin',
        windowsHide: true
      })
    )
  })

  it('does not spawn when a server is already answering', async () => {
    const spawn = vi.fn()
    const server = new IndexTranslateServer({
      launch: {
        serverPath: 'D:\\bin\\llama-server.exe',
        modelPath: 'D:\\models\\Index-Translate-2B.Q4_K_M.gguf',
        bindHost: '127.0.0.1',
        port: 8088,
        endpoint: 'http://127.0.0.1:8088/v1'
      },
      spawn,
      fetchFn: (async () => ({ ok: true })) as unknown as typeof fetch
    })

    await server.start()
    await server.stop()

    expect(spawn).not.toHaveBeenCalled()
  })
})

function fakeChild(): SpawnedIndexTranslateProcess {
  return {
    killed: false,
    pid: 42,
    stdout: { on() {} },
    stderr: { on() {} },
    once() {},
    kill() {
      return true
    }
  }
}
