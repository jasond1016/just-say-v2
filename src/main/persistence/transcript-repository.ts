import type {
  HistoryListQuery,
  HistorySearchQuery,
  PaginatedHistoryResult,
  SavedTranscript
} from '../../shared/api-types'
import type { TranscriptRepository } from '../../core/contracts/storage'

const DEFAULT_PAGE = 1
const DEFAULT_PAGE_SIZE = 20

export class InMemoryTranscriptRepository implements TranscriptRepository {
  private readonly store = new Map<string, SavedTranscript>()

  async save(transcript: SavedTranscript): Promise<void> {
    this.store.set(transcript.id, cloneSavedTranscript(transcript))
  }

  async list(query: HistoryListQuery): Promise<PaginatedHistoryResult> {
    const normalized = normalizeListQuery(query)
    const items = Array.from(this.store.values())
      .filter((transcript) => !normalized.mode || transcript.mode === normalized.mode)
      .sort(compareTranscriptByStartedAtDesc)

    return paginate(items, normalized.page, normalized.pageSize)
  }

  async search(query: HistorySearchQuery): Promise<PaginatedHistoryResult> {
    const normalized = normalizeSearchQuery(query)
    const keyword = normalized.query.trim().toLowerCase()
    const items = Array.from(this.store.values())
      .filter((transcript) => !normalized.mode || transcript.mode === normalized.mode)
      .filter((transcript) => matchesKeyword(transcript, keyword))
      .sort(compareTranscriptByStartedAtDesc)

    return paginate(items, normalized.page, normalized.pageSize)
  }

  async getById(id: string): Promise<SavedTranscript | null> {
    const transcript = this.store.get(id)
    return transcript ? cloneSavedTranscript(transcript) : null
  }

  async delete(id: string): Promise<boolean> {
    return this.store.delete(id)
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

function paginate(
  items: SavedTranscript[],
  page: number,
  pageSize: number
): PaginatedHistoryResult {
  const total = items.length
  const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize)
  const start = (page - 1) * pageSize
  const pagedItems = items.slice(start, start + pageSize).map(cloneSavedTranscript)

  return {
    items: pagedItems,
    total,
    page,
    pageSize,
    totalPages
  }
}

function matchesKeyword(transcript: SavedTranscript, keyword: string): boolean {
  if (!keyword) {
    return true
  }

  return [
    transcript.title,
    transcript.plainText,
    transcript.translatedPlainText ?? '',
    ...transcript.blocks.flatMap((block) => [block.text, block.translatedText ?? ''])
  ].some((value) => value.toLowerCase().includes(keyword))
}

function compareTranscriptByStartedAtDesc(left: SavedTranscript, right: SavedTranscript): number {
  if (left.startedAt !== right.startedAt) {
    return right.startedAt - left.startedAt
  }

  return right.endedAt - left.endedAt
}

function cloneSavedTranscript(transcript: SavedTranscript): SavedTranscript {
  return {
    ...transcript,
    blocks: transcript.blocks.map((block) => ({
      ...block,
      ...(block.words ? { words: [...block.words] } : {})
    })),
    metadata: {
      ...transcript.metadata
    }
  }
}
