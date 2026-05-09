import { describe, expect, it } from 'vitest'

import { float32ToPcm16 } from './browser-capture-source'

describe('float32ToPcm16', () => {
  it('converts normalized float audio samples to little-endian pcm16 bytes', () => {
    const bytes = float32ToPcm16(new Float32Array([-1, 0, 1]))

    expect(Array.from(bytes)).toEqual([0, 128, 0, 0, 255, 127])
  })
})
