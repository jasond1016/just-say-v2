import { describe, expect, it, vi } from 'vitest'
import { SessionDispatchLoop, type SessionEffectResult } from './session-dispatch'

type TestStatus = 'idle' | 'running' | 'error'
type TestEvent =
  | { type: 'START' }
  | { type: 'FINISH' }
  | { type: 'FOLLOW' }
  | { type: 'FAILED'; error: { code: string; message: string; retryable: boolean } }
type TestEffect = 'start' | 'noop' | 'fail' | 'finish'

describe('SessionDispatchLoop', () => {
  it('runs a transition, effect, and follow-up chain', async () => {
    const emits: TestStatus[] = []
    let status: TestStatus = 'idle'

    const dispatch = new SessionDispatchLoop<TestStatus, TestEvent, TestEffect>({
      getStatus: () => status,
      setStatus: (next) => {
        status = next
      },
      transition: (current, event) => {
        if (current === 'idle' && event.type === 'START') {
          return { to: 'running', effect: 'start' }
        }
        if (current === 'running' && event.type === 'FINISH') {
          return { to: 'idle', effect: 'finish' }
        }
        throw new Error(`invalid: ${current} ${event.type}`)
      },
      runEffect: async (effect) => {
        if (effect === 'start') {
          return { followUps: { type: 'FINISH' } }
        }
        return {}
      },
      emitSnapshot: () => {
        emits.push(status)
      },
      createFailedEvent: (error) => ({ type: 'FAILED', error })
    })

    await dispatch.dispatch({ type: 'START' })

    expect(status).toBe('idle')
    expect(emits).toEqual(['running', 'idle'])
  })

  it('enqueues FAILED after an effect returns failed', async () => {
    let status: TestStatus = 'idle'
    const onEffectFailed = vi.fn()

    const dispatch = new SessionDispatchLoop<TestStatus, TestEvent, TestEffect>({
      getStatus: () => status,
      setStatus: (next) => {
        status = next
      },
      transition: (current, event) => {
        if (current === 'idle' && event.type === 'START') {
          return { to: 'running', effect: 'fail' }
        }
        if (event.type === 'FAILED') {
          return { to: 'error', effect: 'noop' }
        }
        throw new Error(`invalid: ${current} ${event.type}`)
      },
      runEffect: async (effect): Promise<SessionEffectResult<TestEvent>> => {
        if (effect === 'fail') {
          return { failed: { code: 'E_ENGINE_UNAVAILABLE', message: 'boom', retryable: true } }
        }
        return {}
      },
      emitSnapshot: () => undefined,
      createFailedEvent: (error) => ({ type: 'FAILED', error }),
      onEffectFailed
    })

    await dispatch.dispatch({ type: 'START' })

    expect(onEffectFailed).toHaveBeenCalledWith({
      effect: 'fail',
      event: { type: 'START' },
      failed: { code: 'E_ENGINE_UNAVAILABLE', message: 'boom', retryable: true }
    })
    expect(status).toBe('error')
  })

  it('re-enqueues events raised while an effect is running', async () => {
    let status: TestStatus = 'idle'
    const order: string[] = []

    const dispatch = new SessionDispatchLoop<TestStatus, TestEvent, TestEffect>({
      getStatus: () => status,
      setStatus: (next) => {
        status = next
      },
      transition: (current, event) => {
        if (current === 'idle' && event.type === 'START') {
          return { to: 'running', effect: 'start' }
        }
        if (current === 'running' && event.type === 'FOLLOW') {
          return { to: 'running', effect: 'noop' }
        }
        if (current === 'running' && event.type === 'FINISH') {
          return { to: 'idle', effect: 'finish' }
        }
        throw new Error(`invalid: ${current} ${event.type}`)
      },
      runEffect: async (effect) => {
        if (effect === 'start') {
          order.push('effect-start')
          await dispatch.dispatch({ type: 'FOLLOW' })
          order.push('effect-end')
          return { followUps: { type: 'FINISH' } }
        }
        order.push(`effect-${effect}`)
        return {}
      },
      emitSnapshot: () => undefined,
      createFailedEvent: (error) => ({ type: 'FAILED', error })
    })

    await dispatch.dispatch({ type: 'START' })

    expect(order).toEqual(['effect-start', 'effect-end', 'effect-noop', 'effect-finish'])
    expect(status).toBe('idle')
  })

  it('serializes top-level dispatches when configured', async () => {
    let status: TestStatus = 'idle'
    const order: string[] = []

    const dispatch = new SessionDispatchLoop<TestStatus, TestEvent, TestEffect>({
      getStatus: () => status,
      setStatus: (next) => {
        status = next
      },
      transition: (current, event) => {
        if (current === 'idle' && event.type === 'START') {
          return { to: 'running', effect: 'start' }
        }
        if (current === 'running' && event.type === 'FOLLOW') {
          return { to: 'running', effect: 'noop' }
        }
        throw new Error(`invalid: ${current} ${event.type}`)
      },
      runEffect: async (effect) => {
        order.push(`effect-${effect}`)
        if (effect === 'start') {
          await new Promise((resolve) => setTimeout(resolve, 0))
        }
        return {}
      },
      emitSnapshot: () => undefined,
      createFailedEvent: (error) => ({ type: 'FAILED', error }),
      serializeTopLevel: true
    })

    const first = dispatch.dispatch({ type: 'START' })
    const second = dispatch.dispatch({ type: 'FOLLOW' })
    await Promise.all([first, second])

    expect(order).toEqual(['effect-start', 'effect-noop'])
  })
})
