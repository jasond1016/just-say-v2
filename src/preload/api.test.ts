import { describe, expect, it, vi } from 'vitest'

import { IPC_CHANNELS } from '../main/ipc/channels'
import { createAppApi } from './api'
import type { IpcInvoke } from './api'

describe('createAppApi', () => {
  it('routes runtime and history methods to the expected IPC channels', async () => {
    const invokeMock = vi.fn(async () => undefined)
    const invoke: IpcInvoke = invokeMock as IpcInvoke
    const api = createAppApi(invoke)

    await api.getRuntime()
    await api.getSettings()
    await api.updateSettings({
      general: {
        theme: 'light'
      }
    })
    await api.prewarmSession('meeting')
    await api.startPtt()
    await api.stopPtt()
    await api.startMeeting({
      includeMicrophone: false,
      translationEnabled: true,
      targetLanguage: 'ja'
    })
    await api.stopMeeting()
    await api.listHistory({ page: 2 })
    await api.searchHistory({ query: 'hello' })
    await api.getHistory('tx-1')
    await api.deleteHistory('tx-1')
    await api.exportHistory('tx-1', 'json')

    expect(invokeMock.mock.calls).toEqual([
      [IPC_CHANNELS.sessionGetRuntime],
      [IPC_CHANNELS.settingsGet],
      [
        IPC_CHANNELS.settingsUpdate,
        {
          general: {
            theme: 'light'
          }
        }
      ],
      [IPC_CHANNELS.sessionPrewarm, 'meeting'],
      [IPC_CHANNELS.sessionStartPtt],
      [IPC_CHANNELS.sessionStopPtt],
      [
        IPC_CHANNELS.sessionStartMeeting,
        {
          includeMicrophone: false,
          translationEnabled: true,
          targetLanguage: 'ja'
        }
      ],
      [IPC_CHANNELS.sessionStopMeeting],
      [IPC_CHANNELS.historyList, { page: 2 }],
      [IPC_CHANNELS.historySearch, { query: 'hello' }],
      [IPC_CHANNELS.historyGet, 'tx-1'],
      [IPC_CHANNELS.historyDelete, 'tx-1'],
      [IPC_CHANNELS.historyExport, 'tx-1', 'json']
    ])
  })
})
