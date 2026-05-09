import { describe, expect, it, vi } from 'vitest'

import { IPC_CHANNELS } from './channels'
import { createSessionHandlers } from './session-handlers'

describe('createSessionHandlers', () => {
  it('maps session IPC channels to the session service', async () => {
    const sessionService = {
      getRuntimeSnapshot: vi.fn().mockReturnValue({
        ptt: {
          status: 'idle'
        },
        liveSession: null,
        services: {
          localService: 'stopped'
        }
      }),
      prewarm: vi.fn().mockResolvedValue(undefined),
      startPtt: vi.fn().mockResolvedValue(undefined),
      stopPtt: vi.fn().mockResolvedValue(undefined),
      startMeeting: vi.fn().mockResolvedValue(undefined),
      stopMeeting: vi.fn().mockResolvedValue(undefined)
    }

    const handlers = createSessionHandlers(sessionService)

    await handlers[IPC_CHANNELS.sessionGetRuntime]()
    await handlers[IPC_CHANNELS.sessionPrewarm]('ptt')
    await handlers[IPC_CHANNELS.sessionStartPtt]()
    await handlers[IPC_CHANNELS.sessionStopPtt]()
    await handlers[IPC_CHANNELS.sessionStartMeeting]({
      includeMicrophone: false,
      translationEnabled: false,
      targetLanguage: 'en'
    })
    await handlers[IPC_CHANNELS.sessionStopMeeting]()

    expect(sessionService.getRuntimeSnapshot).toHaveBeenCalled()
    expect(sessionService.prewarm).toHaveBeenCalledWith('ptt')
    expect(sessionService.startPtt).toHaveBeenCalled()
    expect(sessionService.stopPtt).toHaveBeenCalled()
    expect(sessionService.startMeeting).toHaveBeenCalledWith({
      includeMicrophone: false,
      translationEnabled: false,
      targetLanguage: 'en'
    })
    expect(sessionService.stopMeeting).toHaveBeenCalled()
  })
})
