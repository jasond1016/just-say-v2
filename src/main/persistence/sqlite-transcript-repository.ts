import type { DatabaseSync } from 'node:sqlite'
import type {
  HistoryListQuery,
  HistorySearchQuery,
  PaginatedHistoryResult,
  SavedTranscript,
  TranscriptBlock
} from '../../shared/api-types'
import type { TranscriptRepository } from '../../core/contracts/storage'

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

export class SqliteTranscriptRepository implements TranscriptRepository {
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
    const filter = normalized.mode ? 'WHERE mode = ?' : ''
    const params = normalized.mode ? [normalized.mode] : []
    const rows = this.database
      .prepare(`
        SELECT id, mode, title, started_at, ended_at, language, target_language,
               plain_text, translated_plain_text, metadata_json
        FROM transcripts
        ${filter}
        ORDER BY started_at DESC, ended_at DESC
        LIMIT ? OFFSET ?
      `)
      .all(...params, normalized.pageSize, (normalized.page - 1) * normalized.pageSize) as TranscriptRow[]

    const totalRow = this.database
      .prepare(`SELECT COUNT(*) AS count FROM transcripts ${filter}`)
      .get(...params) as { count: number }

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

    const modeFilter = normalized.mode ? 'AND t.mode = ?' : ''
    const rows = this.database
      .prepare(`
        SELECT
          t.id, t.mode, t.title, t.started_at, t.ended_at, t.language, t.target_language,
          t.plain_text, t.translated_plain_text, t.metadata_json
        FROM transcript_search s
        INNER JOIN transcripts t ON t.id = s.id
        WHERE transcript_search MATCH ?
        ${modeFilter}
        ORDER BY t.started_at DESC, t.ended_at DESC
        LIMIT ? OFFSET ?
      `)
      .all(
        keyword,
        ...(normalized.mode ? [normalized.mode] : []),
        normalized.pageSize,
        (normalized.page - 1) * normalized.pageSize
      ) as TranscriptRow[]

    const totalRow = this.database
      .prepare(`
        SELECT COUNT(*) AS count
        FROM transcript_search s
        INNER JOIN transcripts t ON t.id = s.id
        WHERE transcript_search MATCH ?
        ${modeFilter}
      `)
      .get(
        keyword,
        ...(normalized.mode ? [normalized.mode] : [])
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

  private searchWithLike(query: {
    page: number
    pageSize: number
    mode?: HistoryListQuery['mode']
    query: string
  }): PaginatedHistoryResult {
    const keyword = `%${query.query.trim().toLowerCase()}%`
    const modeFilter = query.mode ? 'AND t.mode = ?' : ''
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
        ${modeFilter}
        ORDER BY t.started_at DESC, t.ended_at DESC
        LIMIT ? OFFSET ?
      `)
      .all(
        keyword,
        keyword,
        keyword,
        keyword,
        keyword,
        ...(query.mode ? [query.mode] : []),
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
        ${modeFilter}
      `)
      .get(
        keyword,
        keyword,
        keyword,
        keyword,
        keyword,
        ...(query.mode ? [query.mode] : [])
      ) as { count: number }

    return this.buildPaginatedResult(rows, totalRow.count, query.page, query.pageSize)
  }
}

function normalizeListQuery(
  query: HistoryListQuery
): { page: number; pageSize: number; mode?: HistoryListQuery['mode'] } {
  return {
    page: normalizePositiveInt(query.page, DEFAULT_PAGE),
    pageSize: normalizePositiveInt(query.pageSize, DEFAULT_PAGE_SIZE),
    ...(query.mode ? { mode: query.mode } : {})
  }
}

function normalizeSearchQuery(
  query: HistorySearchQuery
): { page: number; pageSize: number; mode?: HistoryListQuery['mode']; query: string } {
  return {
    ...normalizeListQuery(query),
    query: query.query
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
