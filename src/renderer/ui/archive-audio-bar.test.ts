import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { formatPlaybackClock, VolumeIcon } from './archive-audio-bar'

describe('formatPlaybackClock', () => {
  it('formats seconds as m:ss', () => {
    expect(formatPlaybackClock(0)).toBe('0:00')
    expect(formatPlaybackClock(16)).toBe('0:16')
    expect(formatPlaybackClock(136)).toBe('2:16')
    expect(formatPlaybackClock(3661)).toBe('61:01')
  })
})

describe('VolumeIcon markup', () => {
  it('uses a single centered svg shell for every volume level', () => {
    const muted = renderToStaticMarkup(React.createElement(VolumeIcon, { level: 'muted' }))
    const high = renderToStaticMarkup(React.createElement(VolumeIcon, { level: 'high' }))

    expect(muted).toContain('viewBox="0 0 20 20"')
    expect(high).toContain('viewBox="0 0 20 20"')
    expect(muted).toContain('archive-audio-bar__icon')
  })
})
