import type { MeetingStatus, PttStatus } from '../../shared/api-types'
import type { MeetingSessionEvent, PttSessionEvent } from './session-types'

export type PttTransitionEffect =
  | 'prepare-capture-request'
  | 'begin-audio-capture'
  | 'stop-capture-and-flush'
  | 'discard-transcript'
  | 'finalize-transcript'
  | 'dispatch-output'
  | 'persist-result'
  | 'record-error'
  | 'clear-runtime'

export type MeetingTransitionEffect =
  | 'resolve-config-and-warmup'
  | 'begin-live-session'
  | 'apply-draft-update'
  | 'append-committed-block'
  | 'stop-capture-and-close-session'
  | 'record-warning'
  | 'record-warning-and-recover'
  | 'record-unexpected-stop'
  | 'finalize-transcript'
  | 'persist-transcript'
  | 'record-error'
  | 'clear-runtime'

export type SessionTransitionResult<
  Status extends string,
  Event extends { type: string },
  Effect extends string
> = {
  from: Status
  to: Status
  event: Event['type']
  changed: boolean
  effect: Effect
}

export class InvalidSessionTransitionError extends Error {
  constructor(machine: 'ptt' | 'meeting', current: string, event: string) {
    super(`Invalid ${machine} transition: ${current} -> ${event}`)
    this.name = 'InvalidSessionTransitionError'
  }
}

export function transitionPttStatus(
  current: PttStatus,
  event: PttSessionEvent
): SessionTransitionResult<PttStatus, PttSessionEvent, PttTransitionEffect> {
  switch (event.type) {
    case 'FAILED':
      if (current === 'idle' || current === 'completed' || current === 'cancelled' || current === 'error') {
        break
      }

      return buildTransition(current, 'error', event, 'record-error')
    case 'RESET':
      if (current === 'completed' || current === 'cancelled' || current === 'error') {
        return buildTransition(current, 'idle', event, 'clear-runtime')
      }
      break
    default:
      break
  }

  switch (current) {
    case 'idle':
      if (event.type === 'PTT_HOTKEY_DOWN') {
        return buildTransition(current, 'arming', event, 'prepare-capture-request')
      }
      break
    case 'arming':
      if (event.type === 'CAPTURE_STARTED') {
        return buildTransition(current, 'capturing', event, 'begin-audio-capture')
      }
      break
    case 'capturing':
      if (event.type === 'PTT_HOTKEY_UP') {
        return buildTransition(current, 'recognizing', event, 'stop-capture-and-flush')
      }
      if (event.type === 'CANCELLED') {
        return buildTransition(current, 'cancelled', event, 'discard-transcript')
      }
      break
    case 'recognizing':
      if (event.type === 'BLOCK_COMMITTED') {
        return buildTransition(current, 'post_processing', event, 'finalize-transcript')
      }
      break
    case 'post_processing':
      if (event.type === 'TRANSLATION_DONE' || event.type === 'SKIP_TRANSLATION') {
        return buildTransition(current, 'delivering', event, 'dispatch-output')
      }
      break
    case 'delivering':
      if (event.type === 'DELIVERY_SUCCEEDED') {
        return buildTransition(current, 'completed', event, 'persist-result')
      }
      if (event.type === 'DELIVERY_FAILED') {
        return buildTransition(current, 'error', event, 'record-error')
      }
      break
    case 'completed':
    case 'cancelled':
    case 'error':
      break
    default:
      return assertNever(current)
  }

  throw new InvalidSessionTransitionError('ptt', current, event.type)
}

export function nextPttStatus(current: PttStatus, event: PttSessionEvent): PttStatus {
  return transitionPttStatus(current, event).to
}

export function transitionMeetingStatus(
  current: MeetingStatus,
  event: MeetingSessionEvent
): SessionTransitionResult<MeetingStatus, MeetingSessionEvent, MeetingTransitionEffect> {
  switch (event.type) {
    case 'FAILED':
      if (current === 'preparing' || current === 'persisting') {
        return buildTransition(current, 'error', event, 'record-error')
      }
      if (current === 'streaming' || current === 'finishing' || current === 'recovering') {
        return buildTransition(current, 'stopped_unexpectedly', event, 'record-unexpected-stop')
      }
      break
    case 'RESET':
      if (current === 'completed' || current === 'stopped_unexpectedly' || current === 'error') {
        return buildTransition(current, 'idle', event, 'clear-runtime')
      }
      break
    default:
      break
  }

  switch (current) {
    case 'idle':
      if (event.type === 'START_REQUESTED') {
        return buildTransition(current, 'preparing', event, 'resolve-config-and-warmup')
      }
      break
    case 'preparing':
      if (event.type === 'SESSION_READY') {
        return buildTransition(current, 'streaming', event, 'begin-live-session')
      }
      break
    case 'streaming':
      if (event.type === 'DRAFT_UPDATED') {
        return buildTransition(current, 'streaming', event, 'apply-draft-update')
      }
      if (event.type === 'BLOCK_COMMITTED') {
        return buildTransition(current, 'streaming', event, 'append-committed-block')
      }
      if (event.type === 'STOP_REQUESTED') {
        return buildTransition(current, 'finishing', event, 'stop-capture-and-close-session')
      }
      if (event.type === 'ENGINE_WARNING') {
        return event.recoverable
          ? buildTransition(current, 'recovering', event, 'record-warning-and-recover')
          : buildTransition(current, 'streaming', event, 'record-warning')
      }
      break
    case 'finishing':
      if (event.type === 'SESSION_ENDED') {
        return buildTransition(current, 'persisting', event, 'finalize-transcript')
      }
      break
    case 'persisting':
      if (event.type === 'PERSIST_SUCCEEDED') {
        return buildTransition(current, 'completed', event, 'persist-transcript')
      }
      if (event.type === 'PERSIST_FAILED') {
        return buildTransition(current, 'error', event, 'record-error')
      }
      break
    case 'recovering':
      if (event.type === 'RECOVERY_SUCCEEDED') {
        return buildTransition(current, 'streaming', event, 'begin-live-session')
      }
      if (event.type === 'RECOVERY_FAILED') {
        return buildTransition(current, 'stopped_unexpectedly', event, 'record-unexpected-stop')
      }
      break
    case 'completed':
    case 'stopped_unexpectedly':
    case 'error':
      break
    default:
      return assertNever(current)
  }

  throw new InvalidSessionTransitionError('meeting', current, event.type)
}

export function nextMeetingStatus(
  current: MeetingStatus,
  event: MeetingSessionEvent
): MeetingStatus {
  return transitionMeetingStatus(current, event).to
}

function buildTransition<
  Status extends string,
  Event extends { type: string },
  Effect extends string
>(
  from: Status,
  to: Status,
  event: Event,
  effect: Effect
): SessionTransitionResult<Status, Event, Effect> {
  return {
    from,
    to,
    event: event.type,
    changed: from !== to,
    effect
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled session status: ${String(value)}`)
}
