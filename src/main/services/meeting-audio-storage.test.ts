import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { access } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'

import type { SavedTranscript } from '../../shared/api-types'
import { MeetingAudioStorage } from './meeting-audio-storage'

describe('MeetingAudioStorage', () => {
  it('mixes system and microphone chunks into one playable wav file', async () => {
    const rootDir = mkdtempSync(path.join(tmpdir(), 'justsay-audio-'))

    try {
      const storage = new MeetingAudioStorage(rootDir, {
        now: () => new Date('2026-05-13T10:00:00.000Z').getTime()
      })
      const recorder = storage.createRecorder({
        sessionId: 'meeting-1',
        chunkMs: 100
      })

      recorder.appendChunk(createChunk('system', 1000, [1000, -1000, 2000, -2000]))
      recorder.appendChunk(createChunk('microphone', 1000, [3000, 1000, -2000, -4000]))
      const metadata = await recorder.finalize('complete')

      expect(metadata).toMatchObject({
        format: 'wav',
        status: 'complete',
        sampleRate: 16000,
        channels: 1
      })

      const outputPath = path.join(rootDir, metadata?.relativePath ?? '')
      const wavFile = readFileSync(outputPath)

      expect(wavFile.subarray(0, 4).toString('ascii')).toBe('RIFF')
      expect(wavFile.subarray(8, 12).toString('ascii')).toBe('WAVE')
      expect(readSamples(wavFile, 4)).toEqual([2000, 0, 0, -3000])

      await expect(
        storage.getPlayback(createTranscriptWithAudio('meeting-1', metadata!))
      ).resolves.toEqual({
        url: expect.stringContaining('meeting-1.wav'),
        status: 'complete'
      })
    } finally {
      rmSync(rootDir, { recursive: true, force: true })
    }
  })

  it('returns null when no audio was recorded', async () => {
    const rootDir = mkdtempSync(path.join(tmpdir(), 'justsay-audio-'))

    try {
      const storage = new MeetingAudioStorage(rootDir)
      const recorder = storage.createRecorder({
        sessionId: 'meeting-empty',
        chunkMs: 100
      })

      await expect(recorder.finalize('partial')).resolves.toBeNull()
    } finally {
      rmSync(rootDir, { recursive: true, force: true })
    }
  })

  it('deletes stored audio together with the history record', async () => {
    const rootDir = mkdtempSync(path.join(tmpdir(), 'justsay-audio-'))

    try {
      const storage = new MeetingAudioStorage(rootDir, {
        now: () => new Date('2026-05-13T10:00:00.000Z').getTime()
      })
      const recorder = storage.createRecorder({
        sessionId: 'meeting-delete',
        chunkMs: 100
      })

      recorder.appendChunk(createChunk('system', 1000, [1200, 800]))
      const metadata = await recorder.finalize('partial')
      const transcript = createTranscriptWithAudio('meeting-delete', metadata!)
      const outputPath = path.join(rootDir, metadata?.relativePath ?? '')

      await access(outputPath)
      await storage.deleteForTranscript(transcript)
      await expect(access(outputPath)).rejects.toThrow()
      await expect(storage.getPlayback(transcript)).resolves.toBeNull()
    } finally {
      rmSync(rootDir, { recursive: true, force: true })
    }
  })
})

function createChunk(
  source: 'system' | 'microphone',
  timestamp: number,
  samples: number[]
) {
  const buffer = Buffer.alloc(samples.length * 2)

  samples.forEach((sample, index) => {
    buffer.writeInt16LE(sample, index * 2)
  })

  return {
    source,
    data: new Uint8Array(buffer),
    sampleRate: 16000,
    channels: 1 as const,
    timestamp
  }
}

function readSamples(wavFile: Buffer, count: number): number[] {
  const samples: number[] = []

  for (let index = 0; index < count; index += 1) {
    samples.push(wavFile.readInt16LE(44 + index * 2))
  }

  return samples
}

function createTranscriptWithAudio(
  id: string,
  audio: NonNullable<SavedTranscript['metadata']['audio']>
): SavedTranscript {
  return {
    id,
    mode: 'meeting',
    title: `Transcript ${id}`,
    startedAt: 1000,
    endedAt: 2000,
    plainText: 'hello world',
    blocks: [
      {
        id: `${id}-block-1`,
        source: 'system',
        text: 'hello world',
        startedAt: 1000,
        endedAt: 2000
      }
    ],
    metadata: {
      engineProfileId: 'local-fast',
      runtimeFamilyId: 'sensevoice',
      modelIdentifier: 'iic/SenseVoiceSmall',
      deploymentMode: 'managed-local',
      includeMicrophone: true,
      translationEnabled: false,
      audio
    }
  }
}
