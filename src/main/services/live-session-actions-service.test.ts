import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { AppRuntimeSnapshot } from '../../shared/api-types'
import { LiveSessionActionsService } from './live-session-actions-service'

describe('LiveSessionActionsService', () => {
  it('copies the visible live session text to the clipboard', async () => {
    const exportDir = mkdtempSync(path.join(tmpdir(), 'justsay-live-session-'))
    const clipboard = {
      writeText: vi.fn(async () => undefined)
    }
    try {
      const service = new LiveSessionActionsService({
        getRuntimeSnapshot: () => createRuntimeSnapshot(),
        clipboard,
        exportDir,
        now: () => 123
      })

      await service.copyPlainText()

      expect(clipboard.writeText).toHaveBeenCalledWith('hello world\nlive preview')
    } finally {
      rmSync(exportDir, { recursive: true, force: true })
    }
  })

  it('exports the current live session snapshot as json', async () => {
    const exportDir = mkdtempSync(path.join(tmpdir(), 'justsay-live-session-'))

    try {
      const service = new LiveSessionActionsService({
        getRuntimeSnapshot: () => createRuntimeSnapshot(),
        clipboard: {
          writeText: vi.fn(async () => undefined)
        },
        exportDir,
        now: () => 456
      })

      const result = await service.export('json')

      expect(result).toEqual({
        ok: true,
        path: path.join(exportDir, 'live-session-meeting-1-456.json')
      })
      expect(readFileSync(result.path!, 'utf8')).toContain('"sessionId": "meeting-1"')
      expect(readFileSync(result.path!, 'utf8')).toContain('"primaryText": "live preview"')
    } finally {
      rmSync(exportDir, { recursive: true, force: true })
    }
  })

  it('returns a product-shaped error when exporting text before transcript content exists', async () => {
    const exportDir = mkdtempSync(path.join(tmpdir(), 'justsay-live-session-'))

    try {
      const service = new LiveSessionActionsService({
        getRuntimeSnapshot: () => ({
          ptt: {
            status: 'idle'
          },
          liveSession: {
            ...createRuntimeSnapshot().liveSession!,
            transcript: {
              committedBlocks: [],
              activeDrafts: {},
              revision: 1
            }
          },
          services: {
            localService: 'healthy'
          }
        }),
        clipboard: {
          writeText: vi.fn(async () => undefined)
        },
        exportDir
      })

      await expect(service.export('plain_text')).resolves.toEqual({
        ok: false,
        error: 'Live session has no transcript content yet.'
      })
    } finally {
      rmSync(exportDir, { recursive: true, force: true })
    }
  })
})

function createRuntimeSnapshot(): AppRuntimeSnapshot {
  return {
    ptt: {
      status: 'idle'
    },
    liveSession: {
      sessionId: 'meeting-1',
      status: 'streaming',
      startedAt: 100,
      durationSec: 42,
      transcript: {
        committedBlocks: [
          {
            id: 'block-1',
            source: 'system',
            text: 'hello world',
            translatedText: 'bonjour le monde',
            startedAt: 100,
            endedAt: 110
          }
        ],
        activeDrafts: {
          microphone: {
            id: 'draft-1',
            source: 'microphone',
            stableText: 'live',
            previewText: 'preview',
            startedAt: 111,
            updatedAt: 112
          }
        },
        revision: 2
      },
      engineProfileId: 'local-fast',
      translationEnabled: true
    },
    services: {
      localService: 'healthy'
    }
  }
}
