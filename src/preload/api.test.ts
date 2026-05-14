import { describe, expect, it, vi } from 'vitest'

import { IPC_CHANNELS } from '../main/ipc/channels'
import { createAppApi } from './api'
import type { IpcInvoke } from './api'

describe('createAppApi', () => {
  it('routes runtime and history methods to the expected IPC channels', async () => {
    const invokeMock = vi.fn(async () => undefined)
    const invoke: IpcInvoke = invokeMock as IpcInvoke
    const events = {
      on: vi.fn(),
      off: vi.fn()
    }
    const api = createAppApi(invoke, events)

    await api.getRuntime()
    const unsubscribe = api.onRuntimeSnapshot(() => {})
    const unsubscribeNotification = api.onRuntimeNotification(() => {})
    await api.getSettings()
    const unsubscribeSettings = api.onSettingsChanged(() => {})
    await api.updateSettings({
      general: {
        theme: 'light'
      }
    })
    await api.saveTranslationCredentials({
      apiKey: 'translation-secret'
    })
    await api.listSpeechProfiles()
    await api.testSpeechProfile('local-fast')
    await api.restartLocalService()
    await api.prewarmSession('meeting')
    await api.startPtt()
    await api.stopPtt()
    await api.copyLatestPttText()
    await api.startMeeting({
      includeMicrophone: false,
      translationEnabled: true,
      targetLanguage: 'ja'
    })
    await api.stopMeeting()
    await api.copyLiveSession()
    await api.exportLiveSession('plain_text')
    await api.listHistory({ page: 2 })
    await api.searchHistory({ query: 'hello' })
    await api.getHistory('tx-1')
    await api.getHistoryNotes('tx-1')
    await api.generateHistoryNotes('tx-1', { force: true })
    await api.getHistoryAudioPlayback('tx-1')
    await api.deleteHistory('tx-1')
    await api.copyHistory('tx-1', 'plain_text')
    await api.exportHistory('tx-1', 'json')
    await api.exportDiagnostics()
    unsubscribe()
    unsubscribeNotification()
    unsubscribeSettings()

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
      [
        IPC_CHANNELS.settingsSaveTranslationCredentials,
        {
          apiKey: 'translation-secret'
        }
      ],
      [IPC_CHANNELS.speechListProfiles],
      [IPC_CHANNELS.speechTestProfile, 'local-fast'],
      [IPC_CHANNELS.speechRestartLocalService],
      [IPC_CHANNELS.sessionPrewarm, 'meeting'],
      [IPC_CHANNELS.sessionStartPtt],
      [IPC_CHANNELS.sessionStopPtt],
      [IPC_CHANNELS.sessionCopyLatestPttText],
      [
        IPC_CHANNELS.sessionStartMeeting,
        {
          includeMicrophone: false,
          translationEnabled: true,
          targetLanguage: 'ja'
        }
      ],
      [IPC_CHANNELS.sessionStopMeeting],
      [IPC_CHANNELS.sessionCopyLiveSession],
      [IPC_CHANNELS.sessionExportLiveSession, 'plain_text'],
      [IPC_CHANNELS.historyList, { page: 2 }],
      [IPC_CHANNELS.historySearch, { query: 'hello' }],
      [IPC_CHANNELS.historyGet, 'tx-1'],
      [IPC_CHANNELS.historyGetNotes, 'tx-1'],
      [IPC_CHANNELS.historyGenerateNotes, 'tx-1', { force: true }],
      [IPC_CHANNELS.historyGetAudioPlayback, 'tx-1'],
      [IPC_CHANNELS.historyDelete, 'tx-1'],
      [IPC_CHANNELS.historyCopy, 'tx-1', 'plain_text'],
      [IPC_CHANNELS.historyExport, 'tx-1', 'json'],
      [IPC_CHANNELS.diagnosticsExport]
    ])
    expect(events.on).toHaveBeenCalledWith(IPC_CHANNELS.runtimeSnapshot, expect.any(Function))
    expect(events.off).toHaveBeenCalledWith(IPC_CHANNELS.runtimeSnapshot, expect.any(Function))
    expect(events.on).toHaveBeenCalledWith(IPC_CHANNELS.runtimeNotification, expect.any(Function))
    expect(events.off).toHaveBeenCalledWith(IPC_CHANNELS.runtimeNotification, expect.any(Function))
    expect(events.on).toHaveBeenCalledWith(IPC_CHANNELS.settingsChanged, expect.any(Function))
    expect(events.off).toHaveBeenCalledWith(IPC_CHANNELS.settingsChanged, expect.any(Function))
  })
})
