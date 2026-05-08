import { describe, expect, it } from 'vitest'

import {
  InvalidSessionTransitionError,
  nextMeetingStatus,
  nextPttStatus,
  transitionMeetingStatus,
  transitionPttStatus
} from './session-machine'

describe('transitionPttStatus', () => {
  it('walks the documented happy path', () => {
    expect(transitionPttStatus('idle', { type: 'PTT_HOTKEY_DOWN' })).toMatchObject({
      to: 'arming',
      effect: 'prepare-capture-request',
      changed: true
    })
    expect(transitionPttStatus('arming', { type: 'CAPTURE_STARTED' })).toMatchObject({
      to: 'capturing',
      effect: 'begin-audio-capture'
    })
    expect(transitionPttStatus('capturing', { type: 'PTT_HOTKEY_UP' })).toMatchObject({
      to: 'recognizing',
      effect: 'stop-capture-and-flush'
    })
    expect(transitionPttStatus('recognizing', { type: 'BLOCK_COMMITTED' })).toMatchObject({
      to: 'post_processing',
      effect: 'finalize-transcript'
    })
    expect(transitionPttStatus('post_processing', { type: 'SKIP_TRANSLATION' })).toMatchObject({
      to: 'delivering',
      effect: 'dispatch-output'
    })
    expect(transitionPttStatus('delivering', { type: 'DELIVERY_SUCCEEDED' })).toMatchObject({
      to: 'completed',
      effect: 'persist-result'
    })
    expect(transitionPttStatus('completed', { type: 'RESET' })).toMatchObject({
      to: 'idle',
      effect: 'clear-runtime'
    })
  })

  it('supports cancellation while capturing', () => {
    expect(transitionPttStatus('capturing', { type: 'CANCELLED' })).toMatchObject({
      to: 'cancelled',
      effect: 'discard-transcript'
    })
    expect(nextPttStatus('cancelled', { type: 'RESET' })).toBe('idle')
  })

  it('routes active-state failures into error', () => {
    expect(transitionPttStatus('recognizing', { type: 'FAILED' })).toMatchObject({
      to: 'error',
      effect: 'record-error'
    })
  })

  it('rejects invalid transitions', () => {
    expect(() => transitionPttStatus('idle', { type: 'PTT_HOTKEY_UP' })).toThrowError(
      InvalidSessionTransitionError
    )
  })
})

describe('transitionMeetingStatus', () => {
  it('walks the documented happy path', () => {
    expect(transitionMeetingStatus('idle', { type: 'START_REQUESTED' })).toMatchObject({
      to: 'preparing',
      effect: 'resolve-config-and-warmup'
    })
    expect(transitionMeetingStatus('preparing', { type: 'SESSION_READY' })).toMatchObject({
      to: 'streaming',
      effect: 'begin-live-session'
    })
    expect(transitionMeetingStatus('streaming', { type: 'DRAFT_UPDATED' })).toMatchObject({
      to: 'streaming',
      effect: 'apply-draft-update',
      changed: false
    })
    expect(transitionMeetingStatus('streaming', { type: 'BLOCK_COMMITTED' })).toMatchObject({
      to: 'streaming',
      effect: 'append-committed-block',
      changed: false
    })
    expect(transitionMeetingStatus('streaming', { type: 'STOP_REQUESTED' })).toMatchObject({
      to: 'finishing',
      effect: 'stop-capture-and-close-session'
    })
    expect(transitionMeetingStatus('finishing', { type: 'SESSION_ENDED' })).toMatchObject({
      to: 'persisting',
      effect: 'finalize-transcript'
    })
    expect(transitionMeetingStatus('persisting', { type: 'PERSIST_SUCCEEDED' })).toMatchObject({
      to: 'completed',
      effect: 'persist-transcript'
    })
    expect(nextMeetingStatus('completed', { type: 'RESET' })).toBe('idle')
  })

  it('stays in streaming for non-recoverable warnings', () => {
    expect(
      transitionMeetingStatus('streaming', { type: 'ENGINE_WARNING', recoverable: false })
    ).toMatchObject({
      to: 'streaming',
      effect: 'record-warning',
      changed: false
    })
  })

  it('moves into recovery when warning is recoverable', () => {
    expect(
      transitionMeetingStatus('streaming', { type: 'ENGINE_WARNING', recoverable: true })
    ).toMatchObject({
      to: 'recovering',
      effect: 'record-warning-and-recover'
    })
    expect(transitionMeetingStatus('recovering', { type: 'RECOVERY_SUCCEEDED' })).toMatchObject({
      to: 'streaming',
      effect: 'begin-live-session'
    })
  })

  it('captures unexpected streaming failures separately from hard errors', () => {
    expect(transitionMeetingStatus('streaming', { type: 'FAILED' })).toMatchObject({
      to: 'stopped_unexpectedly',
      effect: 'record-unexpected-stop'
    })
    expect(nextMeetingStatus('stopped_unexpectedly', { type: 'RESET' })).toBe('idle')
  })

  it('rejects invalid transitions', () => {
    expect(() => transitionMeetingStatus('idle', { type: 'SESSION_READY' })).toThrowError(
      InvalidSessionTransitionError
    )
  })
})
