import { describe, expect, it } from 'vitest'
import { getEnvironmentCredentials } from './environment-credentials-provider'

describe('getEnvironmentCredentials', () => {
  it('returns undefined when no runtime credentials are configured', () => {
    expect(getEnvironmentCredentials({ env: {} })).toBeUndefined()
  })

  it('reads and trims cloud and translation credentials from the environment', () => {
    expect(
      getEnvironmentCredentials({
        env: {
          JUSTSAY_CLOUD_API_KEY: ' cloud-secret ',
          JUSTSAY_TRANSLATION_API_KEY: ' translation-secret '
        }
      })
    ).toEqual({
      cloudApiKey: 'cloud-secret',
      translationApiKey: 'translation-secret'
    })
  })

  it('omits blank credentials', () => {
    expect(
      getEnvironmentCredentials({
        env: {
          JUSTSAY_CLOUD_API_KEY: '   ',
          JUSTSAY_TRANSLATION_API_KEY: 'translation-secret'
        }
      })
    ).toEqual({
      translationApiKey: 'translation-secret'
    })
  })
})
