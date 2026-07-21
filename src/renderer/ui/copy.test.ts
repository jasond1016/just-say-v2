import { describe, expect, it } from 'vitest'

import { enUS } from '../../i18n/en-US'
import { zhCN } from '../../i18n/zh-CN'
import { describeCaptureSource, describeCaptureSourceShort } from './copy'

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

describe('describeCaptureSourceShort', () => {
  it('falls back to short English labels without messages', () => {
    expect(describeCaptureSourceShort('microphone')).toBe('Mic')
    expect(describeCaptureSourceShort('system')).toBe('System')
  })

  it('uses short locale labels when provided', () => {
    expect(describeCaptureSourceShort('microphone', enUS)).toBe('Mic')
    expect(describeCaptureSourceShort('system', enUS)).toBe('System')
    expect(describeCaptureSourceShort('microphone', zhCN)).toBe('麦克')
    expect(describeCaptureSourceShort('system', zhCN)).toBe('系统')
  })
})
