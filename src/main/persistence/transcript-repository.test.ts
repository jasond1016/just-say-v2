import { describe, expect, it } from 'vitest'

import type { SavedTranscript } from '../../shared/api-types'
import { InMemoryTranscriptRepository } from './transcript-repository'

describe('InMemoryTranscriptRepository', () => {
  it('saves and retrieves transcripts by id', async () => {
    const repository = new InMemoryTranscriptRepository()
    const transcript = createTranscript({
      id: 'tx-1',
      mode: 'ptt',
      startedAt: 1000
    })

    await repository.save(transcript)

    expect(await repository.getById('tx-1')).toEqual(transcript)
    expect(await repository.getById('missing')).toBeNull()
  })

  it('updates an existing transcript when the same id is saved again', async () => {
    const repository = new InMemoryTranscriptRepository()

    await repository.save(
      createTranscript({
        id: 'tx-1',
        title: 'First',
        plainText: 'hello',
        startedAt: 1000
      })
    )
    await repository.save(
      createTranscript({
        id: 'tx-1',
        title: 'Updated',
        plainText: 'hello updated',
        startedAt: 1000
      })
    )

    expect(await repository.getById('tx-1')).toMatchObject({
      title: 'Updated',
      plainText: 'hello updated'
    })
  })

  it('lists transcripts in reverse chronological order with paging and mode filters', async () => {
    const repository = new InMemoryTranscriptRepository()

    await repository.save(createTranscript({ id: 'a', mode: 'ptt', startedAt: 1000 }))
    await repository.save(
      createTranscript({
        id: 'b',
        mode: 'meeting',
        startedAt: 3000,
        blocks: [
          {
            id: 'b-block-1',
            source: 'system',
            text: 'meeting audio',
            startedAt: 3000,
            endedAt: 3200
          }
        ]
      })
    )
    await repository.save(createTranscript({ id: 'c', mode: 'ptt', startedAt: 2000 }))

    const firstPage = await repository.list({ page: 1, pageSize: 2 })
    const pttOnly = await repository.list({ mode: 'ptt' })
    const systemOnly = await repository.list({ source: 'system' })
    const recentOnly = await repository.list({ startedAfter: 2500 })

    expect(firstPage.items.map((item) => item.id)).toEqual(['b', 'c'])
    expect(firstPage.total).toBe(3)
    expect(firstPage.totalPages).toBe(2)
    expect(pttOnly.items.map((item) => item.id)).toEqual(['c', 'a'])
    expect(systemOnly.items.map((item) => item.id)).toEqual(['b'])
    expect(recentOnly.items.map((item) => item.id)).toEqual(['b'])
  })

  it('searches across title, plain text, translated text, and block text', async () => {
    const repository = new InMemoryTranscriptRepository()

    await repository.save(
      createTranscript({
        id: 'a',
        title: 'Sprint Sync',
        plainText: 'standup notes',
        startedAt: 1000
      })
    )
    await repository.save(
      createTranscript({
        id: 'b',
        title: 'Client Call',
        plainText: 'hello world',
        translatedPlainText: '你好世界',
        blocks: [
          {
            id: 'block-1',
            source: 'system',
            text: 'hello world',
            translatedText: '你好世界',
            startedAt: 1000,
            endedAt: 1200
          }
        ],
        startedAt: 2000
      })
    )

    const titleMatch = await repository.search({ query: 'sprint' })
    const translatedMatch = await repository.search({ query: '你好' })

    expect(titleMatch.items.map((item) => item.id)).toEqual(['a'])
    expect(translatedMatch.items.map((item) => item.id)).toEqual(['b'])
  })

  it('deletes transcripts and reports whether deletion happened', async () => {
    const repository = new InMemoryTranscriptRepository()

    await repository.save(createTranscript({ id: 'tx-1', startedAt: 1000 }))

    await expect(repository.delete('tx-1')).resolves.toBe(true)
    await expect(repository.delete('tx-1')).resolves.toBe(false)
    await expect(repository.getById('tx-1')).resolves.toBeNull()
  })
})

function createTranscript(overrides: Partial<SavedTranscript> & Pick<SavedTranscript, 'id'>): SavedTranscript {
  const startedAt = overrides.startedAt ?? 1000
  const endedAt = overrides.endedAt ?? startedAt + 500
  const plainText = overrides.plainText ?? 'sample transcript'

  return {
    id: overrides.id,
    mode: overrides.mode ?? 'meeting',
    title: overrides.title ?? `Transcript ${overrides.id}`,
    startedAt,
    endedAt,
    language: overrides.language ?? 'auto',
    plainText,
    blocks:
      overrides.blocks ??
      [
        {
          id: `${overrides.id}-block-1`,
          source: 'microphone',
          text: plainText,
          startedAt,
          endedAt
        }
      ],
    metadata: overrides.metadata ?? {
      engineProfileId: 'local-fast',
      includeMicrophone: true,
      translationEnabled: Boolean(overrides.translatedPlainText)
    },
    ...(overrides.targetLanguage !== undefined ? { targetLanguage: overrides.targetLanguage } : {}),
    ...(overrides.translatedPlainText !== undefined
      ? { translatedPlainText: overrides.translatedPlainText }
      : {})
  }
}
