import { createHash } from 'node:crypto'

import type {
  SavedTranscript,
  TranscriptActionItem,
  TranscriptDecision,
  TranscriptNoteSourceRef,
  TranscriptNotes,
  TranscriptNotesRuntimeConfig,
  TranscriptOpenQuestion
} from '../../shared/api-types'
import { OpenAiCompatibleChatClient, normalizeOptionalString } from './openai-compatible-chat'

export interface NotesProviderClient {
  generateJson(input: {
    systemPrompt: string
    userPrompt: string
  }): Promise<string>
  getModel(): string
}

export type NotesGenerationServiceOptions = {
  createProvider?: (config: TranscriptNotesRuntimeConfig) => NotesProviderClient
  now?: () => number
  promptVersion?: string
  maxChunkChars?: number
}

type ProviderNotesPayload = {
  overview?: unknown
  decisions?: unknown
  actionItems?: unknown
  openQuestions?: unknown
}

type ProviderDecision = {
  summary?: unknown
  sourceBlockIds?: unknown
}

type ProviderActionItem = {
  task?: unknown
  owner?: unknown
  due?: unknown
  sourceBlockIds?: unknown
}

type ProviderOpenQuestion = {
  question?: unknown
  sourceBlockIds?: unknown
}

const DEFAULT_PROMPT_VERSION = 'notes-v1'
const DEFAULT_MAX_CHUNK_CHARS = 12_000
export const DEFAULT_NOTES_TIMEOUT_MS = 60_000

export class NotesGenerationService {
  private readonly createProvider: (config: TranscriptNotesRuntimeConfig) => NotesProviderClient
  private readonly now: () => number
  private readonly promptVersion: string
  private readonly maxChunkChars: number

  constructor(options: NotesGenerationServiceOptions = {}) {
    this.createProvider =
      options.createProvider ??
      createNotesProviderFromEnvironment(process.env, {
        timeoutMs: resolveNotesTimeoutMs(process.env)
      })
    this.now = options.now ?? Date.now
    this.promptVersion = options.promptVersion ?? DEFAULT_PROMPT_VERSION
    this.maxChunkChars = options.maxChunkChars ?? DEFAULT_MAX_CHUNK_CHARS
  }

  getPromptVersion(): string {
    return this.promptVersion
  }

  computeTranscriptHash(transcript: SavedTranscript): string {
    const hash = createHash('sha256')
    hash.update(
      JSON.stringify({
        mode: transcript.mode,
        language: transcript.language ?? null,
        targetLanguage: transcript.targetLanguage ?? null,
        plainText: transcript.plainText,
        translatedPlainText: transcript.translatedPlainText ?? null,
        blocks: transcript.blocks.map((block) => ({
          id: block.id,
          source: block.source,
          speakerLabel: block.speakerLabel ?? null,
          text: block.text,
          translatedText: block.translatedText ?? null,
          startedAt: block.startedAt,
          endedAt: block.endedAt
        }))
      })
    )
    return hash.digest('hex')
  }

  async generate(input: {
    transcript: SavedTranscript
    config: TranscriptNotesRuntimeConfig
  }): Promise<TranscriptNotes> {
    const transcriptBody = buildTranscriptBody(input.transcript)

    if (!transcriptBody.trim()) {
      throw new Error('This transcript does not have enough content to generate notes yet')
    }

    const provider = this.createProvider(input.config)
    const chunks = splitTranscriptIntoChunks(input.transcript, this.maxChunkChars)
    const chunkPayloads =
      chunks.length === 1
        ? [await this.generateChunk(provider, input.transcript, chunks[0]!, input.config.language)]
        : await Promise.all(
            chunks.map((chunk) => this.generateChunk(provider, input.transcript, chunk, input.config.language))
          )
    const mergedPayload =
      chunkPayloads.length === 1
        ? chunkPayloads[0]!
        : await this.mergeChunks(provider, chunkPayloads, input.config.language)

    return mapNotesPayloadToNotes({
      transcript: input.transcript,
      payload: mergedPayload,
      transcriptHash: this.computeTranscriptHash(input.transcript),
      promptVersion: this.promptVersion,
      generatedAt: this.now(),
      language: input.config.language,
      provider: input.config.provider,
      model: provider.getModel()
    })
  }

  private async generateChunk(
    provider: NotesProviderClient,
    transcript: SavedTranscript,
    chunk: SavedTranscript['blocks'],
    language: string
  ): Promise<ProviderNotesPayload> {
    const response = await provider.generateJson({
      systemPrompt: buildChunkSystemPrompt(language),
      userPrompt: [
        `Transcript title: ${transcript.title}`,
        `Session mode: ${transcript.mode}`,
        'Transcript blocks:',
        formatBlocksForPrompt(chunk)
      ].join('\n\n')
    })

    return parseNotesPayload(response)
  }

  private async mergeChunks(
    provider: NotesProviderClient,
    chunkPayloads: ProviderNotesPayload[],
    language: string
  ): Promise<ProviderNotesPayload> {
    const response = await provider.generateJson({
      systemPrompt: buildMergeSystemPrompt(language),
      userPrompt: JSON.stringify(
        {
          summaries: chunkPayloads
        },
        null,
        2
      )
    })

    return parseNotesPayload(response)
  }
}

export function createNotesProviderFromEnvironment(
  env: NodeJS.ProcessEnv,
  options: {
    fetchFn?: typeof fetch
    timeoutMs?: number
  } = {}
): (config: TranscriptNotesRuntimeConfig) => NotesProviderClient {
  const baseUrl = normalizeOptionalString(env.JUSTSAY_TRANSLATION_BASE_URL)
  const model = normalizeOptionalString(env.JUSTSAY_TRANSLATION_MODEL)
  const timeoutMs = resolveNotesTimeoutMs(env, options.timeoutMs)

  return (config) => {
    switch (config.provider) {
      case 'openai-compatible': {
        const client = new OpenAiCompatibleChatClient({
          apiKey: config.credentials.translationApiKey,
          ...(config.endpoint ? { baseUrl: config.endpoint } : baseUrl ? { baseUrl } : {}),
          ...(config.model ? { model: config.model } : model ? { model } : {}),
          ...(timeoutMs !== undefined ? { timeoutMs } : {}),
          ...(options.fetchFn ? { fetchFn: options.fetchFn } : {})
        })

        return {
          generateJson: ({ systemPrompt, userPrompt }) =>
            client.complete({
              temperature: 0,
              responseFormat: 'json_object',
              messages: [
                {
                  role: 'system',
                  content: systemPrompt
                },
                {
                  role: 'user',
                  content: userPrompt
                }
              ]
            }),
          getModel: () => client.getModel()
        }
      }
      default:
        return assertNever(config.provider)
    }
  }
}

export function resolveNotesTimeoutMs(
  env: NodeJS.ProcessEnv,
  overrideTimeoutMs?: number
): number {
  if (overrideTimeoutMs !== undefined) {
    return overrideTimeoutMs
  }

  const envValue = env.JUSTSAY_NOTES_TIMEOUT_MS?.trim()

  if (envValue) {
    const parsed = Number.parseInt(envValue, 10)

    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed
    }
  }

  return DEFAULT_NOTES_TIMEOUT_MS
}

function buildChunkSystemPrompt(language: string): string {
  return [
    'You create structured meeting notes from transcript excerpts.',
    `Write the notes in ${language}.`,
    'Use only what is supported by the transcript.',
    'Do not invent owners, dates, or decisions.',
    'If an owner or due date is missing, return an empty string for that field.',
    'Return JSON only with this exact shape:',
    '{"overview":"string","decisions":[{"summary":"string","sourceBlockIds":["block-id"]}],"actionItems":[{"task":"string","owner":"string","due":"string","sourceBlockIds":["block-id"]}],"openQuestions":[{"question":"string","sourceBlockIds":["block-id"]}]}'
  ].join(' ')
}

function buildMergeSystemPrompt(language: string): string {
  return [
    'You merge structured transcript note fragments into one clean final notes object.',
    `Write the notes in ${language}.`,
    'Deduplicate overlapping items.',
    'Preserve sourceBlockIds from the input.',
    'Use only what is present in the provided JSON.',
    'Return JSON only with the same exact shape as the input fragments.'
  ].join(' ')
}

function buildTranscriptBody(transcript: SavedTranscript): string {
  return transcript.blocks
    .map((block) => block.text.trim())
    .filter(Boolean)
    .join('\n')
}

function splitTranscriptIntoChunks(
  transcript: SavedTranscript,
  maxChunkChars: number
): SavedTranscript['blocks'][] {
  const chunks: SavedTranscript['blocks'][] = []
  let currentChunk: SavedTranscript['blocks'] = []
  let currentLength = 0

  for (const block of transcript.blocks) {
    const blockPrompt = formatBlockForPrompt(block)
    const nextLength = currentLength + blockPrompt.length + 2

    if (currentChunk.length > 0 && nextLength > maxChunkChars) {
      chunks.push(currentChunk)
      currentChunk = []
      currentLength = 0
    }

    currentChunk.push(block)
    currentLength += blockPrompt.length + 2
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk)
  }

  return chunks.length > 0 ? chunks : [transcript.blocks]
}

function formatBlocksForPrompt(blocks: SavedTranscript['blocks']): string {
  return blocks.map((block) => formatBlockForPrompt(block)).join('\n')
}

function formatBlockForPrompt(block: SavedTranscript['blocks'][number]): string {
  return JSON.stringify({
    id: block.id,
    source: block.source,
    speakerLabel: block.speakerLabel ?? '',
    startedAt: block.startedAt,
    endedAt: block.endedAt,
    text: block.text,
    translatedText: block.translatedText ?? ''
  })
}

function parseNotesPayload(response: string): ProviderNotesPayload {
  const trimmed = response.trim()

  try {
    return JSON.parse(trimmed) as ProviderNotesPayload
  } catch {
    const firstBrace = trimmed.indexOf('{')
    const lastBrace = trimmed.lastIndexOf('}')

    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)) as ProviderNotesPayload
    }

    throw new Error('Notes provider returned invalid JSON')
  }
}

function mapNotesPayloadToNotes(input: {
  transcript: SavedTranscript
  payload: ProviderNotesPayload
  transcriptHash: string
  promptVersion: string
  generatedAt: number
  language: string
  provider: TranscriptNotes['provider']
  model: string
}): TranscriptNotes {
  const blockIndex = new Map(
    input.transcript.blocks.map((block) => [
      block.id,
      {
        blockId: block.id,
        startedAt: block.startedAt,
        endedAt: block.endedAt
      } satisfies TranscriptNoteSourceRef
    ])
  )

  return {
    transcriptId: input.transcript.id,
    transcriptHash: input.transcriptHash,
    language: input.language,
    overview: normalizeRequiredText(input.payload.overview, 'No concise summary was available.'),
    decisions: normalizeDecisionList(input.payload.decisions, blockIndex),
    actionItems: normalizeActionItemList(input.payload.actionItems, blockIndex),
    openQuestions: normalizeOpenQuestionList(input.payload.openQuestions, blockIndex),
    generatedAt: input.generatedAt,
    promptVersion: input.promptVersion,
    provider: input.provider,
    model: input.model
  }
}

function normalizeDecisionList(
  value: unknown,
  blockIndex: Map<string, TranscriptNoteSourceRef>
): TranscriptDecision[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((item) => normalizeDecision(item as ProviderDecision, blockIndex))
    .filter((item): item is TranscriptDecision => item !== null)
}

function normalizeDecision(
  value: ProviderDecision,
  blockIndex: Map<string, TranscriptNoteSourceRef>
): TranscriptDecision | null {
  const summary = normalizeOptionalText(value.summary)

  if (!summary) {
    return null
  }

  return {
    summary,
    sourceRefs: normalizeSourceRefs(value.sourceBlockIds, blockIndex)
  }
}

function normalizeActionItemList(
  value: unknown,
  blockIndex: Map<string, TranscriptNoteSourceRef>
): TranscriptActionItem[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((item) => normalizeActionItem(item as ProviderActionItem, blockIndex))
    .filter((item): item is TranscriptActionItem => item !== null)
}

function normalizeActionItem(
  value: ProviderActionItem,
  blockIndex: Map<string, TranscriptNoteSourceRef>
): TranscriptActionItem | null {
  const task = normalizeOptionalText(value.task)

  if (!task) {
    return null
  }

  return {
    task,
    ...(normalizeOptionalText(value.owner) ? { owner: normalizeOptionalText(value.owner)! } : {}),
    ...(normalizeOptionalText(value.due) ? { due: normalizeOptionalText(value.due)! } : {}),
    sourceRefs: normalizeSourceRefs(value.sourceBlockIds, blockIndex)
  }
}

function normalizeOpenQuestionList(
  value: unknown,
  blockIndex: Map<string, TranscriptNoteSourceRef>
): TranscriptOpenQuestion[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((item) => normalizeOpenQuestion(item as ProviderOpenQuestion, blockIndex))
    .filter((item): item is TranscriptOpenQuestion => item !== null)
}

function normalizeOpenQuestion(
  value: ProviderOpenQuestion,
  blockIndex: Map<string, TranscriptNoteSourceRef>
): TranscriptOpenQuestion | null {
  const question = normalizeOptionalText(value.question)

  if (!question) {
    return null
  }

  return {
    question,
    sourceRefs: normalizeSourceRefs(value.sourceBlockIds, blockIndex)
  }
}

function normalizeSourceRefs(
  sourceBlockIds: unknown,
  blockIndex: Map<string, TranscriptNoteSourceRef>
): TranscriptNoteSourceRef[] {
  if (!Array.isArray(sourceBlockIds)) {
    return []
  }

  const seen = new Set<string>()

  return sourceBlockIds
    .map((value) => (typeof value === 'string' ? blockIndex.get(value) : undefined))
    .filter((value): value is TranscriptNoteSourceRef => Boolean(value))
    .filter((value) => {
      if (seen.has(value.blockId)) {
        return false
      }

      seen.add(value.blockId)
      return true
    })
}

function normalizeRequiredText(value: unknown, fallback: string): string {
  return normalizeOptionalText(value) ?? fallback
}

function normalizeOptionalText(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value.trim()
  return normalized ? normalized : undefined
}

function assertNever(value: never): never {
  throw new Error(`Unsupported notes provider: ${String(value)}`)
}
