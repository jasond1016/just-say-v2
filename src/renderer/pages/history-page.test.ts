import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import type { HistoryAudioPlayback, SavedTranscript } from '../../shared/api-types'
import { getArchivePreview, HistoryPage } from './history-page'

describe('HistoryPage audio detail', () => {
  it('renders a meeting audio player when playback is available', () => {
    const transcript = createTranscript({
      metadata: {
        engineProfileId: 'local-fast',
        includeMicrophone: true,
        translationEnabled: false,
        audio: {
          relativePath: 'meetings\\2026\\meeting-1.wav',
          format: 'wav',
          sampleRate: 16000,
          channels: 1,
          status: 'partial',
          durationMs: 2450,
          byteLength: 78444
        }
      }
    })
    const audioPlayback: HistoryAudioPlayback = {
      url: 'file:///C:/audio/meeting-1.wav',
      status: 'partial'
    }

    const markup = renderToStaticMarkup(
      React.createElement(HistoryPage, createProps({
        selectedTranscript: transcript,
        selectedAudio: audioPlayback
      }))
    )

    expect(markup).toContain('Partial audio')
    expect(markup).toContain('<audio')
    expect(markup).toContain('file:///C:/audio/meeting-1.wav')
  })

  it('shows an unavailable state when metadata exists but playback url is missing', () => {
    const transcript = createTranscript({
      metadata: {
        engineProfileId: 'local-fast',
        includeMicrophone: true,
        translationEnabled: false,
        audio: {
          relativePath: 'meetings\\2026\\meeting-1.wav',
          format: 'wav',
          sampleRate: 16000,
          channels: 1,
          status: 'complete',
          durationMs: 3000,
          byteLength: 96444
        }
      }
    })

    const markup = renderToStaticMarkup(
      React.createElement(HistoryPage, createProps({
        selectedTranscript: transcript,
        selectedAudio: null
      }))
    )

    expect(markup).toContain('Audio unavailable')
    expect(markup).toContain('saved meeting audio file is no longer available on disk')
  })
})

describe('getArchivePreview', () => {
  it('returns a compact opening excerpt for archive rows', () => {
    const transcript = createTranscript({
      plainText: 'first line second line third line fourth line',
      blocks: [
        createBlock('first line'),
        createBlock('second line'),
        createBlock('third line')
      ]
    })

    expect(getArchivePreview(transcript, '')).toEqual({
      kind: 'opening',
      text: 'first line second line third line'
    })
  })

  it('returns a contextual search hit instead of the transcript opening', () => {
    const transcript = createTranscript({
      blocks: [
        createBlock('Kickoff and introductions.'),
        createBlock('We need to finalize the migration checklist before Friday and send it to the team.'),
        createBlock('Parking lot items come later.')
      ]
    })

    expect(getArchivePreview(transcript, 'migration')).toEqual({
      kind: 'match',
      text: 'We need to finalize the migration checklist before Friday and send it to the team.'
    })
  })

  it('falls back to the opening excerpt when the search term only matched outside transcript lines', () => {
    const transcript = createTranscript({
      title: 'Migration review',
      blocks: [
        createBlock('Kickoff and introductions.'),
        createBlock('Next steps are still open.')
      ]
    })

    expect(getArchivePreview(transcript, 'review')).toEqual({
      kind: 'opening',
      text: 'Kickoff and introductions. Next steps are still open.'
    })
  })
})

function createProps(overrides: {
  items?: SavedTranscript[]
  searchQuery?: string
  selectedTranscript: SavedTranscript | null
  selectedAudio: HistoryAudioPlayback | null
}) {
  return {
    items: overrides.items ?? [],
    total: 0,
    searchQuery: overrides.searchQuery ?? '',
    selectedMode: 'all' as const,
    selectedSource: 'all' as const,
    selectedTimeFilter: 'all' as const,
    selectedTranscript: overrides.selectedTranscript,
    selectedAudio: overrides.selectedAudio,
    exportMessage: null,
    busyAction: null,
    onOpenQuickDictation: vi.fn(),
    onOpenLiveSession: vi.fn(),
    onSearchQueryChange: vi.fn(),
    onModeChange: vi.fn(),
    onSourceChange: vi.fn(),
    onTimeFilterChange: vi.fn(),
    onOpen: vi.fn(),
    onCloseDetail: vi.fn(),
    onDelete: vi.fn(),
    onCopy: vi.fn(),
    onExport: vi.fn()
  }
}

function createTranscript(overrides: Partial<SavedTranscript> = {}): SavedTranscript {
  return {
    id: overrides.id ?? 'meeting-1',
    mode: overrides.mode ?? 'meeting',
    title: overrides.title ?? 'Weekly sync',
    startedAt: overrides.startedAt ?? 1_000,
    endedAt: overrides.endedAt ?? 4_000,
    plainText: overrides.plainText ?? 'hello world',
    blocks: overrides.blocks ?? [
      {
        id: 'block-1',
        source: 'system',
        text: 'hello world',
        startedAt: 1_000,
        endedAt: 4_000
      }
    ],
    metadata: overrides.metadata ?? {
      engineProfileId: 'local-fast',
      includeMicrophone: true,
      translationEnabled: false
    }
  }
}

function createBlock(text: string) {
  return {
    id: `block-${text}`,
    source: 'system' as const,
    text,
    startedAt: 1_000,
    endedAt: 4_000
  }
}
