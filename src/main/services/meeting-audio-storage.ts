import { access, mkdir, open, readdir, rename, rm, type FileHandle } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type {
  AudioChunk,
  HistoryAudioPlayback,
  SavedTranscript,
  TranscriptAudioMetadata
} from '../../shared/api-types'
import type { CaptureSource } from '../../shared/primitive-types'

const WAV_HEADER_BYTES = 44
const BYTES_PER_SAMPLE = 2
const DEFAULT_SAMPLE_RATE = 16000
const DEFAULT_CHANNELS = 1
const FLUSH_SLOT_LAG = 2

export type MeetingAudioRecorderLike = {
  appendChunk(chunk: AudioChunk): void
  finalize(status: TranscriptAudioMetadata['status']): Promise<TranscriptAudioMetadata | null>
  discard(): Promise<void>
}

export class MeetingAudioStorage {
  private readonly now: () => number

  constructor(
    private readonly rootDir: string,
    options: {
      now?: () => number
    } = {}
  ) {
    this.now = options.now ?? Date.now
  }

  createRecorder(input: {
    sessionId: string
    chunkMs: number
  }): MeetingAudioRecorderLike {
    return new MeetingAudioRecorder(this.rootDir, {
      sessionId: input.sessionId,
      chunkMs: input.chunkMs,
      now: this.now
    })
  }

  async getPlayback(transcript: SavedTranscript): Promise<HistoryAudioPlayback | null> {
    const audio = transcript.metadata.audio

    if (!audio) {
      return null
    }

    const filePath = resolveWithinRoot(this.rootDir, audio.relativePath)

    if (!filePath) {
      return null
    }

    try {
      await access(filePath)
    } catch {
      return null
    }

    return {
      url: pathToFileURL(filePath).toString(),
      status: audio.status
    }
  }

  async deleteForTranscript(transcript: SavedTranscript): Promise<void> {
    const audio = transcript.metadata.audio

    if (!audio) {
      return
    }

    await this.deleteRelativePath(audio.relativePath)
  }

  async deleteRelativePath(relativePath: string): Promise<void> {
    const filePath = resolveWithinRoot(this.rootDir, relativePath)

    if (!filePath) {
      return
    }

    await rm(filePath, { force: true })
    await pruneEmptyParents(path.dirname(filePath), this.rootDir)
  }

  async cleanupTemp(): Promise<void> {
    await rm(path.join(this.rootDir, 'tmp'), { recursive: true, force: true })
  }
}

export class MeetingAudioRecorder implements MeetingAudioRecorderLike {
  private readonly now: () => number
  private readonly sampleRate: number
  private readonly channels: 1
  private readonly chunkMs: number
  private readonly chunkSize: number
  private readonly sessionIdStem: string
  private readonly tempPath: string
  private readonly fileHandlePromise: Promise<FileHandle>
  private readonly slotBuffers = new Map<number, Partial<Record<CaptureSource, Int16Array>>>()
  private pendingWrite: Promise<void> = Promise.resolve()
  private baseTimestamp: number | null = null
  private highestSeenSlot = -1
  private nextFlushSlot = 0
  private totalAudioBytes = 0
  private finalized = false
  private closed = false
  private writeError: Error | null = null

  constructor(
    private readonly rootDir: string,
    options: {
      sessionId: string
      chunkMs: number
      sampleRate?: number
      now?: () => number
    }
  ) {
    this.now = options.now ?? Date.now
    this.sampleRate = options.sampleRate ?? DEFAULT_SAMPLE_RATE
    this.channels = DEFAULT_CHANNELS
    this.chunkMs = options.chunkMs
    this.chunkSize = Math.max(1, Math.floor((this.sampleRate * this.chunkMs) / 1000))
    this.sessionIdStem = sanitizeFileStem(options.sessionId)
    this.tempPath = path.join(
      this.rootDir,
      'tmp',
      `${this.sessionIdStem}-${this.now()}.wav.part`
    )
    this.fileHandlePromise = this.initializeFile()
  }

  appendChunk(chunk: AudioChunk): void {
    if (this.finalized) {
      return
    }

    this.pendingWrite = this.pendingWrite
      .then(async () => {
        await this.handleChunk(chunk)
      })
      .catch((error) => {
        if (!this.writeError) {
          this.writeError = normalizeRecorderError(error)
        }
      })
  }

  async finalize(status: TranscriptAudioMetadata['status']): Promise<TranscriptAudioMetadata | null> {
    if (this.finalized) {
      throw new Error('Meeting audio recorder has already been finalized')
    }

    this.finalized = true

    try {
      await this.pendingWrite
      await this.flushReadySlots(true)

      if (this.writeError) {
        throw this.writeError
      }

      const fileHandle = await this.fileHandlePromise

      if (this.totalAudioBytes === 0) {
        await this.closeFile(fileHandle)
        await rm(this.tempPath, { force: true })
        return null
      }

      const audioMetadata = buildAudioMetadata({
        rootDir: this.rootDir,
        sessionId: this.sessionIdStem,
        status,
        sampleRate: this.sampleRate,
        channels: this.channels,
        totalAudioBytes: this.totalAudioBytes,
        finalizedAt: this.now()
      })
      const finalPath = path.join(this.rootDir, audioMetadata.relativePath)

      await mkdir(path.dirname(finalPath), { recursive: true })
      await fileHandle.write(buildWavHeader(this.totalAudioBytes, this.sampleRate, this.channels), 0, WAV_HEADER_BYTES, 0)
      await this.closeFile(fileHandle)
      await rename(this.tempPath, finalPath)

      return audioMetadata
    } catch (error) {
      await this.cleanupTempFile()
      throw normalizeRecorderError(error)
    }
  }

  async discard(): Promise<void> {
    this.finalized = true

    try {
      await this.pendingWrite
    } catch {
      // recorder write failures are already tracked and cleanup still runs
    }

    await this.cleanupTempFile()
  }

  private async initializeFile(): Promise<FileHandle> {
    await mkdir(path.dirname(this.tempPath), { recursive: true })
    const fileHandle = await open(this.tempPath, 'w')
    await fileHandle.write(Buffer.alloc(WAV_HEADER_BYTES))
    return fileHandle
  }

  private async handleChunk(chunk: AudioChunk): Promise<void> {
    if (this.writeError) {
      return
    }

    if (chunk.channels !== this.channels || chunk.sampleRate !== this.sampleRate) {
      this.writeError = new Error('Unexpected audio chunk shape for meeting recording')
      return
    }

    const slot = this.reserveSlot(chunk)
    const slotBuffers = this.slotBuffers.get(slot) ?? {}
    slotBuffers[chunk.source] = decodePcm16Chunk(chunk.data)
    this.slotBuffers.set(slot, slotBuffers)
    this.highestSeenSlot = Math.max(this.highestSeenSlot, slot)
    await this.flushReadySlots(false)
  }

  private reserveSlot(chunk: AudioChunk): number {
    if (this.baseTimestamp === null) {
      this.baseTimestamp = chunk.timestamp
    }

    let slot = Math.max(0, Math.round((chunk.timestamp - this.baseTimestamp) / this.chunkMs))

    while (this.slotBuffers.get(slot)?.[chunk.source]) {
      slot += 1
    }

    return slot
  }

  private async flushReadySlots(force: boolean): Promise<void> {
    const flushThrough = force ? this.highestSeenSlot : this.highestSeenSlot - FLUSH_SLOT_LAG

    while (this.nextFlushSlot <= flushThrough) {
      const mixed = mixSlotSamples(this.slotBuffers.get(this.nextFlushSlot), this.chunkSize)
      this.slotBuffers.delete(this.nextFlushSlot)
      this.nextFlushSlot += 1

      if (mixed.length === 0) {
        continue
      }

      const fileHandle = await this.fileHandlePromise
      const bytes = encodePcm16Samples(mixed)
      await fileHandle.write(bytes, 0, bytes.length, null)
      this.totalAudioBytes += bytes.length
    }
  }

  private async closeFile(fileHandle: FileHandle): Promise<void> {
    if (this.closed) {
      return
    }

    this.closed = true
    await fileHandle.close()
  }

  private async cleanupTempFile(): Promise<void> {
    try {
      const fileHandle = await this.fileHandlePromise
      await this.closeFile(fileHandle)
    } catch {
      // best effort cleanup
    }

    await rm(this.tempPath, { force: true })
  }
}

function buildAudioMetadata(input: {
  rootDir: string
  sessionId: string
  status: TranscriptAudioMetadata['status']
  sampleRate: number
  channels: 1
  totalAudioBytes: number
  finalizedAt: number
}): TranscriptAudioMetadata {
  const year = new Date(input.finalizedAt).getFullYear()
  const relativePath = path.join('meetings', String(year), `${sanitizeFileStem(input.sessionId)}.wav`)
  const durationMs = Math.round(
    (input.totalAudioBytes / (input.sampleRate * input.channels * BYTES_PER_SAMPLE)) * 1000
  )

  return {
    relativePath,
    format: 'wav',
    sampleRate: input.sampleRate,
    channels: input.channels,
    status: input.status,
    durationMs,
    byteLength: WAV_HEADER_BYTES + input.totalAudioBytes
  }
}

function decodePcm16Chunk(data: Uint8Array): Int16Array {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const samples = new Int16Array(Math.floor(data.byteLength / BYTES_PER_SAMPLE))

  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = view.getInt16(index * BYTES_PER_SAMPLE, true)
  }

  return samples
}

function encodePcm16Samples(samples: Int16Array): Buffer {
  const buffer = Buffer.alloc(samples.length * BYTES_PER_SAMPLE)

  for (let index = 0; index < samples.length; index += 1) {
    buffer.writeInt16LE(samples[index] ?? 0, index * BYTES_PER_SAMPLE)
  }

  return buffer
}

function mixSlotSamples(
  slotBuffers: Partial<Record<CaptureSource, Int16Array>> | undefined,
  chunkSize: number
): Int16Array {
  const inputs = Object.values(slotBuffers ?? {}).filter((samples): samples is Int16Array => Boolean(samples))

  if (inputs.length === 0) {
    return new Int16Array(chunkSize)
  }

  if (inputs.length === 1) {
    return new Int16Array(inputs[0] ?? [])
  }

  const length = Math.max(...inputs.map((samples) => samples.length))
  const output = new Int16Array(length)

  for (let index = 0; index < length; index += 1) {
    let sum = 0
    let contributors = 0

    for (const samples of inputs) {
      if (index >= samples.length) {
        continue
      }

      sum += samples[index] ?? 0
      contributors += 1
    }

    output[index] = contributors === 0 ? 0 : clampPcm16(Math.round(sum / contributors))
  }

  return output
}

function buildWavHeader(dataBytes: number, sampleRate: number, channels: number): Buffer {
  const byteRate = sampleRate * channels * BYTES_PER_SAMPLE
  const blockAlign = channels * BYTES_PER_SAMPLE
  const buffer = Buffer.alloc(WAV_HEADER_BYTES)

  buffer.write('RIFF', 0, 'ascii')
  buffer.writeUInt32LE(36 + dataBytes, 4)
  buffer.write('WAVE', 8, 'ascii')
  buffer.write('fmt ', 12, 'ascii')
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(channels, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(byteRate, 28)
  buffer.writeUInt16LE(blockAlign, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36, 'ascii')
  buffer.writeUInt32LE(dataBytes, 40)

  return buffer
}

function clampPcm16(value: number): number {
  if (value < -0x8000) {
    return -0x8000
  }

  if (value > 0x7fff) {
    return 0x7fff
  }

  return value
}

async function pruneEmptyParents(startDir: string, rootDir: string): Promise<void> {
  let currentDir = startDir
  const normalizedRoot = normalizePathCase(path.resolve(rootDir))

  while (normalizePathCase(currentDir).startsWith(`${normalizedRoot}${path.sep.toLowerCase()}`)) {
    let entries: string[]

    try {
      entries = await readdir(currentDir)
    } catch {
      return
    }

    if (entries.length > 0) {
      return
    }

    await rm(currentDir, { recursive: true, force: true })
    currentDir = path.dirname(currentDir)
  }
}

function resolveWithinRoot(rootDir: string, relativePath: string): string | null {
  const resolvedRoot = path.resolve(rootDir)
  const resolvedPath = path.resolve(rootDir, relativePath)
  const normalizedRoot = `${normalizePathCase(resolvedRoot)}${path.sep.toLowerCase()}`
  const normalizedPath = normalizePathCase(resolvedPath)

  return normalizedPath.startsWith(normalizedRoot) ? resolvedPath : null
}

function normalizePathCase(value: string): string {
  return value.toLowerCase()
}

function sanitizeFileStem(value: string): string {
  return value
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
    .replace(/\s+/g, '-')
    .slice(0, 64) || 'meeting-audio'
}

function normalizeRecorderError(errorLike: unknown): Error {
  return errorLike instanceof Error ? errorLike : new Error('Unknown meeting audio recording error')
}
