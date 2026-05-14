import { describe, expect, it } from 'vitest'

import type { AppRuntimeSnapshot } from '../../shared/api-types'
import {
  getDisplayedSessionDurationSec,
  getDistanceFromLatestContent,
  isLatestContentNearViewportBottom,
  shouldAutoFollowTranscript
} from './live-session-page'

describe('getDisplayedSessionDurationSec', () => {
  it('keeps the live-session timer moving from startedAt while streaming', () => {
    const session = createLiveSession({
      status: 'streaming',
      startedAt: 10_000,
      durationSec: 13
    })

    expect(getDisplayedSessionDurationSec(session, 'streaming', 24_900)).toBe(14)
    expect(getDisplayedSessionDurationSec(session, 'streaming', 25_100)).toBe(15)
  })

  it('never moves backward when the latest snapshot duration is already ahead', () => {
    const session = createLiveSession({
      status: 'streaming',
      startedAt: 10_000,
      durationSec: 18
    })

    expect(getDisplayedSessionDurationSec(session, 'streaming', 27_200)).toBe(18)
  })

  it('uses the persisted duration once the session is no longer live', () => {
    const session = createLiveSession({
      status: 'completed',
      startedAt: 10_000,
      durationSec: 42
    })

    expect(getDisplayedSessionDurationSec(session, 'completed', 80_000)).toBe(42)
  })
})

describe('live transcript auto-follow helpers', () => {
  it('measures how far the viewport is from the latest content', () => {
    expect(getDistanceFromLatestContent({
      latestContentBottom: 720,
      viewportBottom: 672
    })).toBe(48)
  })

  it('treats positions within the 48px threshold as near latest', () => {
    expect(isLatestContentNearViewportBottom({
      latestContentBottom: 719,
      viewportBottom: 672
    })).toBe(true)
  })

  it('counts a visible latest marker as already near latest even if more layout exists below it', () => {
    expect(isLatestContentNearViewportBottom({
      latestContentBottom: 620,
      viewportBottom: 672
    })).toBe(true)
  })

  it('keeps auto-follow paused until the latest marker returns inside the 48px threshold', () => {
    expect(isLatestContentNearViewportBottom({
      latestContentBottom: 720,
      viewportBottom: 672
    })).toBe(false)
  })

  it('only auto-follows while streaming and the user has not scrolled away', () => {
    expect(shouldAutoFollowTranscript(true, false)).toBe(true)
    expect(shouldAutoFollowTranscript(true, true)).toBe(false)
    expect(shouldAutoFollowTranscript(false, false)).toBe(false)
  })
})

function createLiveSession(
  overrides: Partial<NonNullable<AppRuntimeSnapshot['liveSession']>> = {}
): NonNullable<AppRuntimeSnapshot['liveSession']> {
  return {
    sessionId: overrides.sessionId ?? 'meeting-1',
    status: overrides.status ?? 'streaming',
    startedAt: overrides.startedAt ?? 10_000,
    durationSec: overrides.durationSec ?? 12,
    transcript: overrides.transcript ?? {
      committedBlocks: [],
      activeDrafts: {},
      revision: 1
    },
    engineProfileId: overrides.engineProfileId ?? 'local-fast',
    translationEnabled: overrides.translationEnabled ?? false
  }
}
