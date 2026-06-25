import { describe, expect, it } from 'vitest'

import { formatPlaybackClock } from './archive-audio-bar'

describe('formatPlaybackClock', () => {
  it('formats seconds as m:ss', () => {
    expect(formatPlaybackClock(0)).toBe('0:00')
    expect(formatPlaybackClock(16)).toBe('0:16')
    expect(formatPlaybackClock(136)).toBe('2:16')
    expect(formatPlaybackClock(3661)).toBe('61:01')
  })
})
