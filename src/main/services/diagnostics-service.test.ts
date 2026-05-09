import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import type { AppRuntimeSnapshot } from '../../shared/api-types'
import { DiagnosticsService } from './diagnostics-service'

describe('DiagnosticsService', () => {
  it('records events and exports a serializable bundle', async () => {
    const exportDir = mkdtempSync(path.join(tmpdir(), 'justsay-diagnostics-'))
    const service = new DiagnosticsService({
      exportDir,
      appVersion: '0.1.0-test',
      now: () => 1234,
      selectedProfileProvider: () => 'local-fast'
    })

    try {
      service.setLocalServiceStatus('healthy')
      service.record({
        type: 'session-started',
        timestamp: 1000,
        sessionId: 'meeting-1',
        mode: 'meeting'
      })
      service.setLatestFailedSession(createSnapshot())

      const bundle = service.getBundle()

      expect(bundle).toMatchObject({
        appVersion: '0.1.0-test',
        generatedAt: 1234,
        selectedProfileId: 'local-fast',
        localService: 'healthy',
        recentEvents: [
          {
            type: 'session-started',
            sessionId: 'meeting-1'
          }
        ],
        latestFailedSession: {
          liveSession: {
            status: 'stopped_unexpectedly'
          }
        }
      })

      const result = await service.exportDiagnostics()
      expect(result).toEqual({
        ok: true,
        path: path.join(exportDir, 'diagnostics-1234.json')
      })
    } finally {
      rmSync(exportDir, { recursive: true, force: true })
    }
  })
})

function createSnapshot(): AppRuntimeSnapshot {
  return {
    ptt: {
      status: 'idle'
    },
    liveSession: {
      sessionId: 'meeting-1',
      status: 'stopped_unexpectedly',
      startedAt: 1000,
      durationSec: 12,
      transcript: {
        committedBlocks: [],
        activeDrafts: {},
        revision: 0
      },
      engineProfileId: 'local-fast',
      translationEnabled: false
    },
    services: {
      localService: 'failed'
    }
  }
}
