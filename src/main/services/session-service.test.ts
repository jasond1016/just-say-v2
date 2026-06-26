import { describe, expect, it, vi } from 'vitest'

import { SessionService } from './session-service'

describe('SessionService', () => {
  it('delegates coordinator commands and live session actions', async () => {
    const coordinator = {
      getRuntimeSnapshot: vi.fn().mockReturnValue({ ptt: { status: 'idle' }, liveSession: null, services: {} }),
      onSnapshot: vi.fn().mockReturnValue(() => {}),
      onNotification: vi.fn().mockReturnValue(() => {}),
      prewarm: vi.fn().mockResolvedValue(undefined),
      startPtt: vi.fn().mockResolvedValue(undefined),
      stopPtt: vi.fn().mockResolvedValue(undefined),
      copyLatestPttText: vi.fn().mockResolvedValue(undefined),
      startMeeting: vi.fn().mockResolvedValue(undefined),
      stopMeeting: vi.fn().mockResolvedValue(undefined)
    }
    const liveActions = {
      copyPlainText: vi.fn().mockResolvedValue(undefined),
      export: vi.fn().mockResolvedValue({ ok: true, path: 'C:\\exports\\live.txt' })
    }
    const service = new SessionService(coordinator as never, liveActions as never)

    const snapshotListener = vi.fn()
    service.onSnapshot(snapshotListener)
    expect(coordinator.onSnapshot).toHaveBeenCalledWith(snapshotListener)

    await service.prewarm('ptt')
    await service.startPtt()
    await service.stopPtt()
    await service.copyLatestPttText()
    await service.startMeeting({ includeMicrophone: true })
    await service.stopMeeting()
    await service.copyLiveSession()
    await service.exportLiveSession('plain_text')

    expect(coordinator.prewarm).toHaveBeenCalledWith('ptt')
    expect(coordinator.startPtt).toHaveBeenCalled()
    expect(coordinator.stopPtt).toHaveBeenCalled()
    expect(coordinator.copyLatestPttText).toHaveBeenCalled()
    expect(coordinator.startMeeting).toHaveBeenCalledWith({ includeMicrophone: true })
    expect(coordinator.stopMeeting).toHaveBeenCalled()
    expect(liveActions.copyPlainText).toHaveBeenCalled()
    expect(liveActions.export).toHaveBeenCalledWith('plain_text')
  })
})
