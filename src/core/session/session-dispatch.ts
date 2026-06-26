import type { AppErrorPayload } from '../../shared/api-types'

export type SessionEffectResult<Event> =
  | { followUps?: Event | Event[] }
  | { failed: AppErrorPayload }

export type SessionDispatchHandlers<
  Status extends string,
  Event extends { type: string },
  Effect extends string
> = {
  getStatus: () => Status
  setStatus: (status: Status) => void
  transition: (status: Status, event: Event) => { to: Status; effect: Effect }
  runEffect: (effect: Effect, event: Event) => Promise<SessionEffectResult<Event>>
  emitSnapshot: () => void
  createFailedEvent: (error: AppErrorPayload) => Event
  effectNeedsPostEmit?: (effect: Effect) => boolean
  onTransition?: (input: { event: Event; from: Status; to: Status; effect: Effect }) => void
  onEffectFailed?: (input: { effect: Effect; event: Event; failed: AppErrorPayload }) => void
  /** Serialize top-level dispatches so engine events cannot overlap session control flows. */
  serializeTopLevel?: boolean
  /** Allow events raised during an effect to join the active dispatch queue. */
  enableReentrantEnqueue?: boolean
}

export function normalizeSessionFollowUps<Event>(followUps: Event | Event[]): Event[] {
  return Array.isArray(followUps) ? followUps : [followUps]
}

export class SessionDispatchLoop<
  Status extends string,
  Event extends { type: string },
  Effect extends string
> {
  private controlEventSink: ((event: Event) => void) | null = null
  private readonly serialQueue: Array<{
    event: Event
    resolve: () => void
    reject: (error: unknown) => void
  }> = []
  private serialRunning = false

  constructor(private readonly handlers: SessionDispatchHandlers<Status, Event, Effect>) {}

  dispatch(event: Event): Promise<void> {
    if (this.shouldUseReentrantSink()) {
      this.controlEventSink!(event)
      return Promise.resolve()
    }

    if (this.handlers.serializeTopLevel) {
      return new Promise((resolve, reject) => {
        this.serialQueue.push({ event, resolve, reject })
        this.pumpSerialDispatch()
      })
    }

    return this.runLoop(event)
  }

  private shouldUseReentrantSink(): boolean {
    return (this.handlers.enableReentrantEnqueue ?? true) && this.controlEventSink !== null
  }

  private pumpSerialDispatch(): void {
    if (this.serialRunning || this.serialQueue.length === 0) {
      return
    }

    this.serialRunning = true
    const { event, resolve, reject } = this.serialQueue.shift()!

    void this.runLoop(event)
      .then(resolve)
      .catch(reject)
      .finally(() => {
        this.serialRunning = false
        this.pumpSerialDispatch()
      })
  }

  private async runLoop(initialEvent: Event): Promise<void> {
    const queue: Event[] = [initialEvent]
    const enableReentrantEnqueue = this.handlers.enableReentrantEnqueue ?? true

    if (enableReentrantEnqueue) {
      this.controlEventSink = (followUp) => {
        queue.push(followUp)
      }
    }

    try {
      while (queue.length > 0) {
        const next = queue.shift()!
        const from = this.handlers.getStatus()
        const result = this.handlers.transition(from, next)
        this.handlers.setStatus(result.to)
        this.handlers.onTransition?.({
          event: next,
          from,
          to: result.to,
          effect: result.effect
        })
        this.handlers.emitSnapshot()

        const effectResult = await this.handlers.runEffect(result.effect, next)

        if (this.handlers.effectNeedsPostEmit?.(result.effect)) {
          this.handlers.emitSnapshot()
        }

        if ('failed' in effectResult) {
          this.handlers.onEffectFailed?.({
            effect: result.effect,
            event: next,
            failed: effectResult.failed
          })
          queue.push(this.handlers.createFailedEvent(effectResult.failed))
          continue
        }

        if (effectResult.followUps) {
          queue.push(...normalizeSessionFollowUps(effectResult.followUps))
        }
      }
    } finally {
      if (enableReentrantEnqueue) {
        this.controlEventSink = null
      }
    }
  }
}
