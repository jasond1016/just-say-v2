import { describe, expect, it } from 'vitest'

import { registerIpcHandlers } from './register-ipc'

describe('registerIpcHandlers', () => {
  it('registers every handler from each handler group', () => {
    const calls: Array<{ channel: string; handler: (...args: unknown[]) => Promise<unknown> }> = []

    registerIpcHandlers(
      {
        handle(channel, handler) {
          calls.push({ channel, handler })
        }
      },
      {
        'history.list': async () => ({ items: [] })
      },
      {
        'session.getRuntime': async () => ({})
      }
    )

    expect(calls.map((call) => call.channel)).toEqual(['history.list', 'session.getRuntime'])
  })
})
