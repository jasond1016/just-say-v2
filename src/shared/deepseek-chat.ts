export function isDeepSeekChatEndpoint(endpoint: string | undefined): boolean {
  const hostname = hostnameFromEndpoint(endpoint)

  if (!hostname) {
    return false
  }

  return hostname === 'deepseek.com' || hostname.endsWith('.deepseek.com')
}

function hostnameFromEndpoint(endpoint: string | undefined): string | undefined {
  const trimmed = endpoint?.trim()

  if (!trimmed) {
    return undefined
  }

  try {
    const withProtocol = hasUrlProtocol(trimmed) ? trimmed : `https://${trimmed}`
    return new URL(withProtocol).hostname.toLowerCase()
  } catch {
    return undefined
  }
}

function hasUrlProtocol(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value)
}
