import type { EngineProfile, ProfileTestResult } from '../../shared/api-types'
import { IPC_CHANNELS } from './channels'

export type SpeechHandlerService = {
  listProfiles(): Promise<EngineProfile[]>
  testProfile(profileId: string): Promise<ProfileTestResult>
  restartLocalService(): Promise<void>
}

export type SpeechHandlers = {
  [IPC_CHANNELS.speechListProfiles]: () => Promise<EngineProfile[]>
  [IPC_CHANNELS.speechTestProfile]: (profileId: string) => Promise<ProfileTestResult>
  [IPC_CHANNELS.speechRestartLocalService]: () => Promise<void>
}

export function createSpeechHandlers(speechService: SpeechHandlerService): SpeechHandlers {
  return {
    [IPC_CHANNELS.speechListProfiles]: async () => speechService.listProfiles(),
    [IPC_CHANNELS.speechTestProfile]: async (profileId) => speechService.testProfile(profileId),
    [IPC_CHANNELS.speechRestartLocalService]: async () => speechService.restartLocalService()
  }
}
