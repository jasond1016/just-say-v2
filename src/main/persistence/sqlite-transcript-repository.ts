import type { DatabaseSync } from 'node:sqlite'
import type {
  HistoryListQuery,
  HistorySearchQuery,
  PaginatedHistoryResult,
  SavedTranscript,
  TranscriptBlock,
  TranscriptNotes
} from '../../shared/api-types'
import type { TranscriptNotesRepository, TranscriptRepository } from '../../core/contracts/storage'

const DEFAULT_PAGE = 1
const DEFAULT_PAGE_SIZE = 20

type TranscriptRow = {
  id: string
  mode: SavedTranscript['mode']
  title: string
  started_at: number
  ended_at: number
  language: string | null
  target_language: string | null
  plain_text: string
  translated_plain_text: string | null
  metadata_json: string
}

type TranscriptBlockRow = {
  id: string
  transcript_id: string
  seq: number
  source: TranscriptBlock['source']
  speaker_label: string | null
  text: string
  translated_text: string | null
  started_at: number
  ended_at: number
  words_json: string | null
}

type TranscriptNotesRow = {
  transcript_id: string
  transcript_hash: string
  language: string
  provider: TranscriptNotes['provider']
  model: string
  prompt_version: string
  notes_json: string
  generated_at: number
}

export class SqliteTranscriptRepository implements TranscriptRepository, TranscriptNotesRepository {
  constructor(
    private readonly database: DatabaseSync,
    private readonly now: () => number = Date.now
  ) {}

  async save(transcript: SavedTranscript): Promise<void> {
    const now = this.now()
    const existing = this.database
      .prepare('SELECT created_at FROM transcripts WHERE id = ?')
      .get(transcript.id) as { created_at: number } | undefined
    const blockSearchText = transcript.blocks
      .flatMap((block) => [block.text, block.translatedText ?? ''])
      .filter(Boolean)
      .join('\n')

    this.database.exec('BEGIN')

    try {
      this.database
        .prepare(`
          INSERT OR REPLACE INTO transcripts (
            id, mode, title, started_at, ended_at, language, target_language,
            plain_text, translated_plain_text, metadata_json, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          transcript.id,
          transcript.mode,
          transcript.title,
          transcript.startedAt,
          transcript.endedAt,
          transcript.language ?? null,
          transcript.targetLanguage ?? null,
          transcript.plainText,
          transcript.translatedPlainText ?? null,
          JSON.stringify(transcript.metadata),
          existing?.created_at ?? now,
          now
        )

      this.database.prepare('DELETE FROM transcript_blocks WHERE transcript_id = ?').run(transcript.id)
      this.database.prepare('DELETE FROM transcript_search WHERE id = ?').run(transcript.id)

      const insertBlock = this.database.prepare(`
        INSERT INTO transcript_blocks (
          id, transcript_id, seq, source, speaker_label, text,
          translated_text, started_at, ended_at, words_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)

      transcript.blocks.forEach((block, index) => {
        insertBlock.run(
          block.id,
          transcript.id,
          index,
          block.source,
          block.speakerLabel ?? null,
          block.text,
          block.translatedText ?? null,
          block.startedAt,
          block.endedAt,
          block.words ? JSON.stringify(block.words) : null
        )
      })

      this.database
        .prepare(`
          INSERT INTO transcript_search (
            id,
            title,
            plain_text,
            translated_plain_text,
            block_text
          ) VALUES (?, ?, ?, ?, ?)
        `)
        .run(
          transcript.id,
          transcript.title,
          transcript.plainText,
          transcript.translatedPlainText ?? '',
          blockSearchText
        )

      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  async list(query: HistoryListQuery = {}): Promise<PaginatedHistoryResult> {
    const normalized = normalizeListQuery(query)
    const filter = buildTranscriptFilter(normalized, 'transcripts')
    const rows = this.database
      .prepare(`
        SELECT id, mode, title, started_at, ended_at, language, target_language,
               plain_text, translated_plain_text, metadata_json
        FROM transcripts
        ${filter.clause}
        ORDER BY started_at DESC, ended_at DESC
        LIMIT ? OFFSET ?
      `)
      .all(...filter.params, normalized.pageSize, (normalized.page - 1) * normalized.pageSize) as TranscriptRow[]

    const totalRow = this.database
      .prepare(`SELECT COUNT(*) AS count FROM transcripts ${filter.clause}`)
      .get(...filter.params) as { count: number }

    return this.buildPaginatedResult(rows, totalRow.count, normalized.page, normalized.pageSize)
  }

  async search(query: HistorySearchQuery): Promise<PaginatedHistoryResult> {
    const normalized = normalizeSearchQuery(query)
    const keyword = buildFtsQuery(normalized.query)

    if (!keyword) {
      return this.list(
        normalized.mode
          ? {
              page: normalized.page,
              pageSize: normalized.pageSize,
              mode: normalized.mode
            }
          : {
              page: normalized.page,
              pageSize: normalized.pageSize
            }
      )
    }

    const filter = buildTranscriptFilter(normalized, 't')
    const rows = this.database
      .prepare(`
        SELECT
          t.id, t.mode, t.title, t.started_at, t.ended_at, t.language, t.target_language,
          t.plain_text, t.translated_plain_text, t.metadata_json
        FROM transcript_search s
        INNER JOIN transcripts t ON t.id = s.id
        WHERE transcript_search MATCH ?
        ${filter.andClause}
        ORDER BY t.started_at DESC, t.ended_at DESC
        LIMIT ? OFFSET ?
      `)
      .all(
        keyword,
        ...filter.params,
        normalized.pageSize,
        (normalized.page - 1) * normalized.pageSize
      ) as TranscriptRow[]

    const totalRow = this.database
      .prepare(`
        SELECT COUNT(*) AS count
        FROM transcript_search s
        INNER JOIN transcripts t ON t.id = s.id
        WHERE transcript_search MATCH ?
        ${filter.andClause}
      `)
      .get(
        keyword,
        ...filter.params
      ) as { count: number }

    if (rows.length === 0 && normalized.query.trim()) {
      return this.searchWithLike(normalized)
    }

    return this.buildPaginatedResult(rows, totalRow.count, normalized.page, normalized.pageSize)
  }

  async getById(id: string): Promise<SavedTranscript | null> {
    const row = this.database
      .prepare(`
        SELECT id, mode, title, started_at, ended_at, language, target_language,
               plain_text, translated_plain_text, metadata_json
        FROM transcripts
        WHERE id = ?
      `)
      .get(id) as TranscriptRow | undefined

    if (!row) {
      return null
    }

    return this.mapTranscriptRow(row)
  }

  async getNotesByTranscriptId(id: string): Promise<TranscriptNotes | null> {
    const row = this.database
      .prepare(`
        SELECT transcript_id, transcript_hash, language, provider, model, prompt_version, notes_json, generated_at
        FROM transcript_notes
        WHERE transcript_id = ?
      `)
      .get(id) as TranscriptNotesRow | undefined

    if (!row) {
      return null
    }

    return this.mapTranscriptNotesRow(row)
  }

  async saveNotes(notes: TranscriptNotes): Promise<void> {
    const now = this.now()
    this.database
      .prepare(`
        INSERT OR REPLACE INTO transcript_notes (
          transcript_id, transcript_hash, language, provider, model, prompt_version,
          notes_json, generated_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        notes.transcriptId,
        notes.transcriptHash,
        notes.language,
        notes.provider,
        notes.model,
        notes.promptVersion,
        JSON.stringify({
          overview: notes.overview,
          decisions: notes.decisions,
          actionItems: notes.actionItems,
          openQuestions: notes.openQuestions
        }),
        notes.generatedAt,
        now
      )
  }

  async delete(id: string): Promise<boolean> {
    this.database.prepare('DELETE FROM transcript_search WHERE id = ?').run(id)
    const result = this.database.prepare('DELETE FROM transcripts WHERE id = ?').run(id) as { changes?: number }
    return (result.changes ?? 0) > 0
  }

  private buildPaginatedResult(
    rows: TranscriptRow[],
    total: number,
    page: number,
    pageSize: number
  ): PaginatedHistoryResult {
    return {
      items: rows.map((row) => this.mapTranscriptRow(row)),
      total,
      page,
      pageSize,
      totalPages: total === 0 ? 0 : Math.ceil(total / pageSize)
    }
  }

  private mapTranscriptRow(row: TranscriptRow): SavedTranscript {
    const blocks = this.database
      .prepare(`
        SELECT id, transcript_id, seq, source, speaker_label, text, translated_text,
               started_at, ended_at, words_json
        FROM transcript_blocks
        WHERE transcript_id = ?
        ORDER BY seq ASC
      `)
      .all(row.id) as TranscriptBlockRow[]

    return {
      id: row.id,
      mode: row.mode,
      title: row.title,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      ...(row.language ? { language: row.language } : {}),
      ...(row.target_language ? { targetLanguage: row.target_language } : {}),
      plainText: row.plain_text,
      ...(row.translated_plain_text ? { translatedPlainText: row.translated_plain_text } : {}),
      blocks: blocks.map((block) => ({
        id: block.id,
        source: block.source,
        ...(block.speaker_label ? { speakerLabel: block.speaker_label } : {}),
        text: block.text,
        ...(block.translated_text ? { translatedText: block.translated_text } : {}),
        startedAt: block.started_at,
        endedAt: block.ended_at,
        ...(block.words_json ? { words: JSON.parse(block.words_json) } : {})
      })),
      metadata: JSON.parse(row.metadata_json) as SavedTranscript['metadata']
    }
  }

  private mapTranscriptNotesRow(row: TranscriptNotesRow): TranscriptNotes {
    const notesJson = JSON.parse(row.notes_json) as Pick<
      TranscriptNotes,
      'overview' | 'decisions' | 'actionItems' | 'openQuestions'
    >

    return {
      transcriptId: row.transcript_id,
      transcriptHash: row.transcript_hash,
      language: row.language,
      overview: notesJson.overview,
      decisions: notesJson.decisions,
      actionItems: notesJson.actionItems,
      openQuestions: notesJson.openQuestions,
      generatedAt: row.generated_at,
      promptVersion: row.prompt_version,
      provider: row.provider,
      model: row.model
    }
  }

  private searchWithLike(query: {
    page: number
    pageSize: number
    mode?: HistoryListQuery['mode']
    query: string
  }): PaginatedHistoryResult {
    const keyword = `%${query.query.trim().toLowerCase()}%`
    const filter = buildTranscriptFilter(query, 't')
    const rows = this.database
      .prepare(`
        SELECT DISTINCT
          t.id, t.mode, t.title, t.started_at, t.ended_at, t.language, t.target_language,
          t.plain_text, t.translated_plain_text, t.metadata_json
        FROM transcripts t
        LEFT JOIN transcript_blocks b ON b.transcript_id = t.id
        WHERE (
          LOWER(t.title) LIKE ?
          OR LOWER(t.plain_text) LIKE ?
          OR LOWER(COALESCE(t.translated_plain_text, '')) LIKE ?
          OR LOWER(COALESCE(b.text, '')) LIKE ?
          OR LOWER(COALESCE(b.translated_text, '')) LIKE ?
        )
        ${filter.andClause}
        ORDER BY t.started_at DESC, t.ended_at DESC
        LIMIT ? OFFSET ?
      `)
      .all(
        keyword,
        keyword,
        keyword,
        keyword,
        keyword,
        ...filter.params,
        query.pageSize,
        (query.page - 1) * query.pageSize
      ) as TranscriptRow[]

    const totalRow = this.database
      .prepare(`
        SELECT COUNT(DISTINCT t.id) AS count
        FROM transcripts t
        LEFT JOIN transcript_blocks b ON b.transcript_id = t.id
        WHERE (
          LOWER(t.title) LIKE ?
          OR LOWER(t.plain_text) LIKE ?
          OR LOWER(COALESCE(t.translated_plain_text, '')) LIKE ?
          OR LOWER(COALESCE(b.text, '')) LIKE ?
          OR LOWER(COALESCE(b.translated_text, '')) LIKE ?
        )
        ${filter.andClause}
      `)
      .get(
        keyword,
        keyword,
        keyword,
        keyword,
        keyword,
        ...filter.params
      ) as { count: number }

    return this.buildPaginatedResult(rows, totalRow.count, query.page, query.pageSize)
  }
}

function normalizeListQuery(
  query: HistoryListQuery
): {
  page: number
  pageSize: number
  mode?: HistoryListQuery['mode']
  startedAfter?: number
  source?: HistoryListQuery['source']
} {
  return {
    page: normalizePositiveInt(query.page, DEFAULT_PAGE),
    pageSize: normalizePositiveInt(query.pageSize, DEFAULT_PAGE_SIZE),
    ...(query.mode ? { mode: query.mode } : {}),
    ...(typeof query.startedAfter === 'number' ? { startedAfter: query.startedAfter } : {}),
    ...(query.source ? { source: query.source } : {})
  }
}

function normalizeSearchQuery(
  query: HistorySearchQuery
): {
  page: number
  pageSize: number
  mode?: HistoryListQuery['mode']
  startedAfter?: number
  source?: HistoryListQuery['source']
  query: string
} {
  return {
    ...normalizeListQuery(query),
    query: query.query
  }
}

function buildTranscriptFilter(
  query: {
    mode?: HistoryListQuery['mode']
    startedAfter?: number
    source?: HistoryListQuery['source']
  },
  transcriptAlias: string
): { clause: string; andClause: string; params: Array<string | number> } {
  const clauses: string[] = []
  const params: Array<string | number> = []

  if (query.mode) {
    clauses.push(`${transcriptAlias}.mode = ?`)
    params.push(query.mode)
  }

  if (query.startedAfter !== undefined) {
    clauses.push(`${transcriptAlias}.started_at >= ?`)
    params.push(query.startedAfter)
  }

  if (query.source) {
    clauses.push(
      `EXISTS (
        SELECT 1
        FROM transcript_blocks source_blocks
        WHERE source_blocks.transcript_id = ${transcriptAlias}.id
          AND source_blocks.source = ?
      )`
    )
    params.push(query.source)
  }

  return {
    clause: clauses.length === 0 ? '' : `WHERE ${clauses.join(' AND ')}`,
    andClause: clauses.length === 0 ? '' : `AND ${clauses.join(' AND ')}`,
    params
  }
}

function normalizePositiveInt(value: number | undefined, fallback: number): number {
  if (!value || !Number.isInteger(value) || value < 1) {
    return fallback
  }

  return value
}

function buildFtsQuery(input: string): string {
  const tokens = input
    .trim()
    .split(/\s+/)
    .map((token) => token.replace(/"/g, '""'))
    .filter(Boolean)

  if (tokens.length === 0) {
    return ''
  }

  return tokens.map((token) => `"${token}"`).join(' AND ')
}
