import { describe, expect, it } from 'vitest'

import {
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
