import { describe, expect, it } from 'vitest'

import {
  applySettingsPatch,
  createDefaultSettings,
  DEFAULT_SETTINGS,
  normalizeSettings
} from './settings-schema'

describe('settings-schema', () => {
  it('creates isolated default settings objects', () => {
    const first = createDefaultSettings()
    const second = createDefaultSettings()

    first.advanced.experimentalFlags.push('mutated')

    expect(second.advanced.experimentalFlags).toEqual([])
    expect(first).not.toBe(second)
  })

  it('normalizes invalid values back to supported defaults', () => {
    const normalized = normalizeSettings({
      speech: {
        selectedProfileId: 'missing-profile',
        language: 'de' as never
      },
      input: {
        pttHotkey: 'Ctrl' as never,
        microphoneDeviceId: '   '
      },
      output: {
        method: 'toast' as never
      },
      translation: {
        targetLanguage: '   ',
        provider: 'unknown' as never
      },
      advanced: {
        localServiceHost: '   ',
        localServicePort: 99999,
        experimentalFlags: [' alpha ', '', 'alpha', ' beta ']
      }
    })

    expect(normalized.speech.selectedProfileId).toBe(DEFAULT_SETTINGS.speech.selectedProfileId)
    expect(normalized.speech.language).toBe(DEFAULT_SETTINGS.speech.language)
    expect(normalized.input.pttHotkey).toBe(DEFAULT_SETTINGS.input.pttHotkey)
    expect(normalized.input.microphoneDeviceId).toBe('default')
    expect(normalized.output.method).toBe(DEFAULT_SETTINGS.output.method)
    expect(normalized.translation.targetLanguage).toBe(DEFAULT_SETTINGS.translation.targetLanguage)
    expect(normalized.translation.provider).toBe(DEFAULT_SETTINGS.translation.provider)
    expect(normalized.advanced.localServiceHost).toBeUndefined()
    expect(normalized.advanced.localServicePort).toBe(8765)
    expect(normalized.advanced.experimentalFlags).toEqual(['alpha', 'beta'])
  })

  it('applies nested patches without dropping untouched settings', () => {
    const patched = applySettingsPatch(DEFAULT_SETTINGS, {
      general: {
        theme: 'dark'
      },
      translation: {
        enabledForMeeting: true,
        targetLanguage: 'ja'
      },
      advanced: {
        experimentalFlags: ['exp-a']
      }
    })

    expect(patched.general.theme).toBe('dark')
    expect(patched.general.language).toBe(DEFAULT_SETTINGS.general.language)
    expect(patched.translation.enabledForMeeting).toBe(true)
    expect(patched.translation.enabledForPtt).toBe(false)
    expect(patched.advanced.experimentalFlags).toEqual(['exp-a'])
  })
})
