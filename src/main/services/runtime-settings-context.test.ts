import { describe, expect, it, vi } from 'vitest'

import { InMemorySettingsRepository } from '../persistence/settings-repository'
import { RuntimeSettingsContext } from './runtime-settings-context'
import { SettingsService } from './settings-service'

describe('RuntimeSettingsContext', () => {
  it('exposes synchronous cached settings to coordinators', async () => {
    const context = await createContext()

    const provider = context.createSettingsProvider()

    expect(provider.getSettings()).toMatchObject({
      speech: {
        selectedProfileId: 'local-fast'
      }
    })
    expect(provider.resolveRuntimeConfig('ptt')).toMatchObject({
      engineProfile: {
        id: 'local-fast'
      }
    })
  })

  it('refreshes coordinator cache and triggers deployment changes after settings updates', async () => {
    const onDeploymentSignatureChange = vi.fn()
    const context = await createContext()
    context.onDeploymentSignatureChange(onDeploymentSignatureChange)
    const provider = context.createSettingsProvider()

    await context.updateSettings({
      advanced: {
        localServiceMode: 'remote-service',
        remoteServiceHost: '127.0.0.1',
        remoteServicePort: 9000
      }
    })

    expect(provider.getSettings().advanced.localServiceMode).toBe('remote-service')
    expect(onDeploymentSignatureChange).toHaveBeenCalledTimes(1)
  })

  it('does not trigger deployment changes for unrelated settings updates', async () => {
    const onDeploymentSignatureChange = vi.fn()
    const context = await createContext()
    context.onDeploymentSignatureChange(onDeploymentSignatureChange)

    await context.updateSettings({
      general: {
        theme: 'dark'
      }
    })

    expect(onDeploymentSignatureChange).not.toHaveBeenCalled()
  })

  it('saves translation credentials and exposes notes runtime config', async () => {
    const credentialsRepository = createCredentialsRepository()
    const context = await createContext({ credentialsRepository })

    await context.saveTranslationCredentials({
      apiKey: 'translation-secret'
    })

    expect(context.resolveTranscriptNotesRuntimeConfig()).toMatchObject({
      credentials: {
        translationApiKey: 'translation-secret'
      }
    })
    expect(context.getSettings().translation.apiKeyConfigured).toBe(true)
  })

  it('resolves profile checks from the cached Runtime Settings snapshot', async () => {
    const context = await createContext()
    const resolver = context.createRuntimeConfigResolver()

    await expect(resolver.resolveProfileRuntimeConfig('local-fast', 'meeting')).resolves.toMatchObject({
      engineProfile: {
        id: 'local-fast'
      }
    })
  })
})

async function createContext(
  overrides: {
    credentialsRepository?: ReturnType<typeof createCredentialsRepository>
  } = {}
) {
  const credentialsRepository = overrides.credentialsRepository ?? createCredentialsRepository()
  const settingsService = new SettingsService(new InMemorySettingsRepository())

  return RuntimeSettingsContext.create({
    settingsService,
    credentialsRepository
  })
}

function createCredentialsRepository() {
  const store: { translationApiKey?: string } = {}

  return {
    store,
    async get() {
      return { ...store }
    },
    async save(credentials: { translationApiKey?: string }) {
      Object.assign(store, credentials)
    }
  }
}
