import type { ResolverCredentials } from '../../core/settings/settings-resolver'

export type EnvironmentCredentialsProviderOptions = {
  env?: NodeJS.ProcessEnv
}

export function getEnvironmentCredentials(
  options: EnvironmentCredentialsProviderOptions = {}
): ResolverCredentials | undefined {
  const env = options.env ?? process.env
  const cloudApiKey = normalizeCredential(env.JUSTSAY_CLOUD_API_KEY)
  const translationApiKey = normalizeCredential(env.JUSTSAY_TRANSLATION_API_KEY)

  if (!cloudApiKey && !translationApiKey) {
    return undefined
  }

  return {
    ...(cloudApiKey ? { cloudApiKey } : {}),
    ...(translationApiKey ? { translationApiKey } : {})
  }
}

function normalizeCredential(value: string | undefined): string | undefined {
  const normalized = value?.trim()
  return normalized ? normalized : undefined
}
