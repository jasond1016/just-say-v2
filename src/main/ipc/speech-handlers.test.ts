import { describe, expect, it, vi } from 'vitest'

import { IPC_CHANNELS } from './channels'
import { createSpeechHandlers } from './speech-handlers'

describe('createSpeechHandlers', () => {
  it('maps speech IPC channels to the speech service', async () => {
    const speechService = {
      listProfiles: vi.fn().mockResolvedValue([]),
      testProfile: vi.fn().mockResolvedValue({
        ok: true,
        profileId: 'local-fast'
      })
    }

    const handlers = createSpeechHandlers(speechService)

    await handlers[IPC_CHANNELS.speechListProfiles]()
    await handlers[IPC_CHANNELS.speechTestProfile]('local-fast')

    expect(speechService.listProfiles).toHaveBeenCalled()
    expect(speechService.testProfile).toHaveBeenCalledWith('local-fast')
  })
})
