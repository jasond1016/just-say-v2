import { describe, expect, it } from 'vitest'

import {
  isCrossSourceNearDuplicate,
  normalizeTranscriptTextForCompare
} from './cross-source-near-duplicate'

describe('cross-source-near-duplicate', () => {
  it('treats filler-stripped near copies as duplicates', () => {
    const system = '元々予定になかったところではつくばが新規構築なので 元々の'
    const mic = 'でえっと元々予定になかったところではつくばがえっと新規構築なので えっと元々'

    expect(isCrossSourceNearDuplicate(mic, system)).toBe(true)
  })

  it('keeps clearly different mic speech', () => {
    expect(
      isCrossSourceNearDuplicate('今日の天気はどうですか', '元々予定になかったところではつくばが新規構築なので')
    ).toBe(false)
  })

  it('normalizes fillers and punctuation away', () => {
    expect(normalizeTranscriptTextForCompare('えっと、こんにちは。')).toBe('こんにちは')
  })
})
