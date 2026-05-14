import { describe, expect, it } from 'vitest'

import {
  hasConnectionDraftChanges,
  hasTranslationDraftChanges,
  getTranslationTargetSelectValue,
  TRANSLATION_TARGET_OPTIONS
} from './settings-page'

describe('translation target dropdown', () => {
  it('only exposes Chinese, English, and Japanese options', () => {
    expect(TRANSLATION_TARGET_OPTIONS).toEqual([
      { value: 'zh', label: 'Chinese' },
      { value: 'en', label: 'English' },
      { value: 'ja', label: 'Japanese' }
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
