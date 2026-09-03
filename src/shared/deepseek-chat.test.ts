import { describe, expect, it } from 'vitest'

import { isDeepSeekChatEndpoint } from './deepseek-chat'

describe('isDeepSeekChatEndpoint', () => {
  it('accepts official DeepSeek API hosts', () => {
    expect(isDeepSeekChatEndpoint('https://api.deepseek.com')).toBe(true)
    expect(isDeepSeekChatEndpoint('https://api.deepseek.com/v1')).toBe(true)
    expect(isDeepSeekChatEndpoint('https://api.deepseek.com/v1/')).toBe(true)
    expect(isDeepSeekChatEndpoint('https://API.DEEPSEEK.COM/v1')).toBe(true)
    expect(isDeepSeekChatEndpoint('api.deepseek.com')).toBe(true)
  })

  it('rejects missing values and non-DeepSeek hosts', () => {
    expect(isDeepSeekChatEndpoint(undefined)).toBe(false)
    expect(isDeepSeekChatEndpoint('')).toBe(false)
    expect(isDeepSeekChatEndpoint('   ')).toBe(false)
    expect(isDeepSeekChatEndpoint('https://api.openai.com/v1')).toBe(false)
    expect(isDeepSeekChatEndpoint('https://example.test/v1')).toBe(false)
    expect(isDeepSeekChatEndpoint('https://api.deepseek.com.evil.example/v1')).toBe(false)
  })
})
