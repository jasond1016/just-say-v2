import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import type { SavedTranscript } from '../../shared/api-types'
import { openSqliteDatabase } from './sqlite'
import { SqliteTranscriptRepository } from './sqlite-transcript-repository'

describe('SqliteTranscriptRepository', () => {
  it('persists, lists, searches, and deletes transcripts', async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'justsay-sqlite-'))
    const database = openSqliteDatabase(path.join(tempDir, 'history.db'))

    try {
      const repository = new SqliteTranscriptRepository(database, () => 5000)

      await repository.save(createTranscript({ id: 'a', title: 'Sprint Sync', plainText: 'standup notes', startedAt: 1000 }))
      await repository.save(
        createTranscript({
          id: 'b',
          mode: 'meeting',
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
      await repository.save(
        createTranscript({
          id: 'c',
          mode: 'ptt',
          title: 'Desk Note',
          plainText: 'follow up tomorrow',
          startedAt: 3000
        })
      )

      expect((await repository.list({})).items.map((item) => item.id)).toEqual(['c', 'b', 'a'])
      expect((await repository.list({ mode: 'meeting' })).items.map((item) => item.id)).toEqual(['b', 'a'])
      expect((await repository.list({ source: 'system' })).items.map((item) => item.id)).toEqual(['b'])
      expect((await repository.list({ startedAfter: 2500 })).items.map((item) => item.id)).toEqual(['c'])
      expect((await repository.search({ query: '你好' })).items.map((item) => item.id)).toEqual(['b'])
      expect((await repository.search({ query: 'hello', source: 'system' })).items.map((item) => item.id)).toEqual(['b'])
      expect((await repository.search({ query: 'follow up', mode: 'ptt' })).items.map((item) => item.id)).toEqual(['c'])
      expect(await repository.getById('a')).toMatchObject({
        id: 'a',
        title: 'Sprint Sync'
      })
      await expect(repository.delete('a')).resolves.toBe(true)
      await expect(repository.getById('a')).resolves.toBeNull()
    } finally {
      database.close()
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('replaces transcript rows and refreshes the search index on update', async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'justsay-sqlite-'))
    const database = openSqliteDatabase(path.join(tempDir, 'history.db'))

    try {
      const repository = new SqliteTranscriptRepository(database, () => 5000)
      await repository.save(createTranscript({ id: 'tx-1', plainText: 'draft agenda' }))
      await repository.save(createTranscript({ id: 'tx-1', plainText: 'final summary', title: 'Updated Summary' }))

      await expect(repository.search({ query: 'draft' })).resolves.toMatchObject({
        items: []
      })
      await expect(repository.search({ query: 'summary' })).resolves.toMatchObject({
        items: [
          expect.objectContaining({
            id: 'tx-1',
            title: 'Updated Summary',
            plainText: 'final summary'
          })
        ]
      })
    } finally {
      database.close()
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('round-trips audio metadata stored inside transcript metadata_json', async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'justsay-sqlite-'))
    const database = openSqliteDatabase(path.join(tempDir, 'history.db'))

    try {
      const repository = new SqliteTranscriptRepository(database, () => 5000)
      await repository.save(
        createTranscript({
          id: 'tx-audio',
          metadata: {
            engineProfileId: 'local-fast',
            runtimeFamilyId: 'sensevoice',
            modelIdentifier: 'iic/SenseVoiceSmall',
            deploymentMode: 'managed-local',
            includeMicrophone: true,
            translationEnabled: false,
            audio: {
              relativePath: 'meetings\\2026\\tx-audio.wav',
              format: 'wav',
              sampleRate: 16000,
              channels: 1,
              status: 'partial',
              durationMs: 2400,
              byteLength: 80444
            }
          }
        })
      )

      await expect(repository.getById('tx-audio')).resolves.toMatchObject({
        id: 'tx-audio',
        metadata: {
          audio: {
            relativePath: 'meetings\\2026\\tx-audio.wav',
            status: 'partial',
            byteLength: 80444
          }
        }
      })
    } finally {
      database.close()
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('persists and loads generated transcript notes', async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'justsay-sqlite-'))
    const database = openSqliteDatabase(path.join(tempDir, 'history.db'))

    try {
      const repository = new SqliteTranscriptRepository(database, () => 5000)
      await repository.save(createTranscript({ id: 'tx-notes' }))
      await repository.saveNotes({
        transcriptId: 'tx-notes',
        transcriptHash: 'hash-tx-notes',
        language: 'en',
        overview: 'Discussed blockers and agreed next steps.',
        decisions: [
          {
            summary: 'Ship after QA sign-off.',
            sourceRefs: [{ blockId: 'tx-notes-block-1', startedAt: 1000, endedAt: 1500 }]
          }
        ],
        actionItems: [
          {
            task: 'Send the QA checklist.',
            owner: 'Mina',
            due: 'Friday',
            sourceRefs: [{ blockId: 'tx-notes-block-1', startedAt: 1000, endedAt: 1500 }]
          }
        ],
        openQuestions: [],
        generatedAt: 4000,
        promptVersion: 'notes-v1',
        provider: 'openai-compatible',
        model: 'gpt-4o-mini'
      })

      await expect(repository.getNotesByTranscriptId('tx-notes')).resolves.toEqual({
        transcriptId: 'tx-notes',
        transcriptHash: 'hash-tx-notes',
        language: 'en',
        overview: 'Discussed blockers and agreed next steps.',
        decisions: [
          {
            summary: 'Ship after QA sign-off.',
            sourceRefs: [{ blockId: 'tx-notes-block-1', startedAt: 1000, endedAt: 1500 }]
          }
        ],
        actionItems: [
          {
            task: 'Send the QA checklist.',
            owner: 'Mina',
            due: 'Friday',
            sourceRefs: [{ blockId: 'tx-notes-block-1', startedAt: 1000, endedAt: 1500 }]
          }
        ],
        openQuestions: [],
        generatedAt: 4000,
        promptVersion: 'notes-v1',
        provider: 'openai-compatible',
        model: 'gpt-4o-mini'
      })
    } finally {
      database.close()
      rmSync(tempDir, { recursive: true, force: true })
    }
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
      runtimeFamilyId: 'sensevoice',
      modelIdentifier: 'iic/SenseVoiceSmall',
      deploymentMode: 'managed-local',
      includeMicrophone: true,
      translationEnabled: Boolean(overrides.translatedPlainText)
    },
    ...(overrides.targetLanguage !== undefined ? { targetLanguage: overrides.targetLanguage } : {}),
    ...(overrides.translatedPlainText !== undefined
      ? { translatedPlainText: overrides.translatedPlainText }
      : {})
  }
}
