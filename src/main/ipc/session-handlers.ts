import type { AppRuntimeSnapshot, StartMeetingCommand } from '../../shared/api-types'
import type { SessionMode } from '../../shared/primitive-types'
import { IPC_CHANNELS } from './channels'

export type SessionHandlerService = {
  getRuntimeSnapshot(): AppRuntimeSnapshot
  prewarm(mode: SessionMode): Promise<void>
  startMeeting(input?: StartMeetingCommand): Promise<void>
  stopMeeting(): Promise<void>
}

export type SessionHandlers = {
  [IPC_CHANNELS.sessionGetRuntime]: () => Promise<AppRuntimeSnapshot>
  [IPC_CHANNELS.sessionPrewarm]: (mode: SessionMode) => Promise<void>
  [IPC_CHANNELS.sessionStartMeeting]: (input?: StartMeetingCommand) => Promise<void>
  [IPC_CHANNELS.sessionStopMeeting]: () => Promise<void>
}

export function createSessionHandlers(sessionService: SessionHandlerService): SessionHandlers {
  return {
    [IPC_CHANNELS.sessionGetRuntime]: async () => sessionService.getRuntimeSnapshot(),
    [IPC_CHANNELS.sessionPrewarm]: async (mode) => sessionService.prewarm(mode),
    [IPC_CHANNELS.sessionStartMeeting]: async (input) => sessionService.startMeeting(input),
    [IPC_CHANNELS.sessionStopMeeting]: async () => sessionService.stopMeeting()
  }
}
