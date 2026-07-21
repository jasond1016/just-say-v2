import { describe, expect, it } from 'vitest'

import {
  countGraphemes,
  isMicrophoneShortJunkCommit,
  isMicrophoneShortJunkText,
  MIC_MIN_DURATION_MS,
  MIC_MIN_GRAPHEMES
} from './mic-short-junk'

describe('mic-short-junk', () => {
  it('counts CJK graphemes after trim', () => {
    expect(countGraphemes('  哦  ')).toBe(1)
    expect(countGraphemes('原名')).toBe(2)
    expect(countGraphemes('有一次')).toBe(3)
    expect(countGraphemes('はい')).toBe(2)
  })

  it('flags screenshot-like short junk under min graphemes', () => {
    expect(MIC_MIN_GRAPHEMES).toBe(3)
    expect(isMicrophoneShortJunkText('哦')).toBe(true)
    expect(isMicrophoneShortJunkText('对')).toBe(true)
    expect(isMicrophoneShortJunkText('原名')).toBe(true)
    expect(isMicrophoneShortJunkText('はい')).toBe(true)
    expect(isMicrophoneShortJunkText('有一次')).toBe(false)
  })

  it('flags short-duration commits even when text is long enough', () => {
    expect(MIC_MIN_DURATION_MS).toBe(300)
    expect(
      isMicrophoneShortJunkCommit({
        text: '有一次',
        startedAt: 1000,
        endedAt: 1200
      })
    ).toBe(true)
    expect(
      isMicrophoneShortJunkCommit({
        text: '有一次',
        startedAt: 1000,
        endedAt: 1400
      })
    ).toBe(false)
  })
})
