import { describe, expect, it } from 'vitest'

import {
  hasConnectionDraftChanges,
  hasTranslationDraftChanges,
  getTranslationTargetSelectValue,
  shouldShowTranslationThinkingToggle,
  TRANSLATION_TARGET_OPTIONS
} from './settings-page'

describe('translation target dropdown', () => {
  it('only exposes Chinese, English, and Japanese options', () => {
    expect(TRANSLATION_TARGET_OPTIONS).toEqual([
      { value: 'zh', labelKey: 'settingsTranslationTargetZh' },
      { value: 'en', labelKey: 'settingsTranslationTargetEn' },
      { value: 'ja', labelKey: 'settingsTranslationTargetJa' }
    ])
  })

  it('maps legacy aliases onto the supported dropdown values', () => {
    expect(getTranslationTargetSelectValue('cn')).toBe('zh')
    expect(getTranslationTargetSelectValue('en-US')).toBe('en')
    expect(getTranslationTargetSelectValue('ja-jp')).toBe('ja')
  })

  it('falls back to English for unsupported stored values', () => {
    expect(getTranslationTargetSelectValue('fr')).toBe('en')
  })
})

describe('DeepSeek translation thinking toggle', () => {
  it('appears for DeepSeek endpoints, including unsaved draft URLs', () => {
    expect(shouldShowTranslationThinkingToggle('https://api.deepseek.com/v1', undefined)).toBe(true)
    expect(shouldShowTranslationThinkingToggle('', 'https://api.deepseek.com')).toBe(true)
    expect(shouldShowTranslationThinkingToggle('https://api.openai.com/v1', 'https://api.deepseek.com')).toBe(false)
    expect(shouldShowTranslationThinkingToggle('https://api.openai.com/v1', undefined)).toBe(false)
  })
})

describe('settings grouped save helpers', () => {
  it('treats endpoint, model, or api key edits as unsaved translation changes', () => {
    expect(hasTranslationDraftChanges({
      enabledForPtt: false,
      enabledForMeeting: false,
      targetLanguage: 'en',
      provider: 'openai-compatible',
      endpoint: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini'
    }, {
      endpoint: 'https://api.deepseek.com',
      model: 'gpt-4o-mini',
      apiKey: ''
    })).toBe(true)

    expect(hasTranslationDraftChanges({
      enabledForPtt: false,
      enabledForMeeting: false,
      targetLanguage: 'en',
      provider: 'openai-compatible',
      endpoint: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini'
    }, {
      endpoint: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      apiKey: 'sk-test'
    })).toBe(true)
  })

  it('treats matching connection drafts as clean and trimmed changes as dirty', () => {
    expect(hasConnectionDraftChanges({
      host: '127.0.0.1',
      port: 8765
    }, {
      host: '127.0.0.1',
      port: '8765'
    })).toBe(false)

    expect(hasConnectionDraftChanges({
      host: '127.0.0.1',
      port: 8765
    }, {
      host: ' 10.0.0.8 ',
      port: '8765'
    })).toBe(true)
  })
})
