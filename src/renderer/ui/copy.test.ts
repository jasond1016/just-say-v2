import { describe, expect, it } from 'vitest'

import { enUS } from '../../i18n/en-US'
import { zhCN } from '../../i18n/zh-CN'
import { describeCaptureSource } from './copy'

describe('describeCaptureSource', () => {
  it('falls back to English labels without messages', () => {
    expect(describeCaptureSource('microphone')).toBe('Microphone')
    expect(describeCaptureSource('system')).toBe('System audio')
  })

  it('uses locale messages when provided', () => {
    expect(describeCaptureSource('microphone', enUS)).toBe('Microphone')
    expect(describeCaptureSource('system', enUS)).toBe('System audio')
    expect(describeCaptureSource('microphone', zhCN)).toBe('麦克风')
    expect(describeCaptureSource('system', zhCN)).toBe('系统音频')
  })
})
