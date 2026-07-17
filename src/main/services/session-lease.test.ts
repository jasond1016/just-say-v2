import { describe, expect, it } from 'vitest'

import { INITIAL_RUNTIME_SNAPSHOT } from '../../shared/runtime-snapshot'
import {
  assertRecognitionLeaseAvailable,
  createLeaseConflictError,
  isMeetingLeaseHeld,
  isPttLeaseHeld,
  resolveRecognitionLease
} from './session-lease'

describe('session-lease', () => {
  it('treats non-idle ptt status as holding the lease', () => {
    expect(isPttLeaseHeld('capturing')).toBe(true)
    expect(isPttLeaseHeld('idle')).toBe(false)
  })

  it('treats active live sessions as holding the lease', () => {
    expect(
      isMeetingLeaseHeld({
        sessionId: 'meeting-1',
        status: 'streaming',
        startedAt: 1,
        durationSec: 0,
        transcript: { committedBlocks: [], activeDrafts: {}, revision: 0 },
        engineProfileId: 'local-fast',
        translationEnabled: false
      })
    ).toBe(true)
    expect(isMeetingLeaseHeld(null)).toBe(false)
  })

  it('prefers meeting when both snapshots appear active', () => {
    expect(
      resolveRecognitionLease({
        ptt: { status: 'capturing' },
        liveSession: {
          sessionId: 'meeting-1',
          status: 'streaming',
          startedAt: 1,
          durationSec: 0,
          transcript: { committedBlocks: [], activeDrafts: {}, revision: 0 },
          engineProfileId: 'local-fast',
          translationEnabled: false
        }
      })
    ).toBe('meeting')
  })

  it('rejects cross-mode starts with operator-facing capture errors', () => {
    const snapshot = {
      ...INITIAL_RUNTIME_SNAPSHOT,
      ptt: { status: 'capturing' as const }
    }

    expect(() => assertRecognitionLeaseAvailable(snapshot, 'meeting')).toThrowError(
      /PTT session is already active/
    )
    expect(() => assertRecognitionLeaseAvailable(snapshot, 'meeting')).toThrow(
      expect.objectContaining({
        payload: {
          code: 'E_CAPTURE_UNAVAILABLE',
          message: 'A PTT session is already active',
          retryable: false
        }
      })
    )
  })

  it('allows same-mode commands while the lease is already held by that mode', () => {
    const snapshot = {
      ...INITIAL_RUNTIME_SNAPSHOT,
      ptt: { status: 'capturing' as const }
    }

    expect(() => assertRecognitionLeaseAvailable(snapshot, 'ptt')).not.toThrow()
  })

  it('creates conflict errors with stable payload shape', () => {
    expect(createLeaseConflictError('meeting', 'ptt')).toMatchObject({
      message: 'A live meeting session is already active',
      payload: {
        code: 'E_CAPTURE_UNAVAILABLE',
        retryable: false
      }
    })
  })
})
