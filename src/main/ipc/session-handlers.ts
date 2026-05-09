import type { AppRuntimeSnapshot, ExportFormat, ExportResult, StartMeetingCommand } from '../../shared/api-types'
import type { SessionMode } from '../../shared/primitive-types'
import { IPC_CHANNELS } from './channels'

export type SessionHandlerService = {
  getRuntimeSnapshot(): AppRuntimeSnapshot
  prewarm(mode: SessionMode): Promise<void>
  startPtt(): Promise<void>
  stopPtt(): Promise<void>
  copyLatestPttText(): Promise<void>
  startMeeting(input?: StartMeetingCommand): Promise<void>
  stopMeeting(): Promise<void>
  copyLiveSession(): Promise<void>
  exportLiveSession(format: ExportFormat): Promise<ExportResult>
}

export type SessionHandlers = {
  [IPC_CHANNELS.sessionGetRuntime]: () => Promise<AppRuntimeSnapshot>
  [IPC_CHANNELS.sessionPrewarm]: (mode: SessionMode) => Promise<void>
  [IPC_CHANNELS.sessionStartPtt]: () => Promise<void>
  [IPC_CHANNELS.sessionStopPtt]: () => Promise<void>
  [IPC_CHANNELS.sessionCopyLatestPttText]: () => Promise<void>
  [IPC_CHANNELS.sessionStartMeeting]: (input?: StartMeetingCommand) => Promise<void>
  [IPC_CHANNELS.sessionStopMeeting]: () => Promise<void>
  [IPC_CHANNELS.sessionCopyLiveSession]: () => Promise<void>
  [IPC_CHANNELS.sessionExportLiveSession]: (format: ExportFormat) => Promise<ExportResult>
}

export function createSessionHandlers(sessionService: SessionHandlerService): SessionHandlers {
  return {
    [IPC_CHANNELS.sessionGetRuntime]: async () => sessionService.getRuntimeSnapshot(),
    [IPC_CHANNELS.sessionPrewarm]: async (mode) => sessionService.prewarm(mode),
    [IPC_CHANNELS.sessionStartPtt]: async () => sessionService.startPtt(),
    [IPC_CHANNELS.sessionStopPtt]: async () => sessionService.stopPtt(),
    [IPC_CHANNELS.sessionCopyLatestPttText]: async () => sessionService.copyLatestPttText(),
    [IPC_CHANNELS.sessionStartMeeting]: async (input) => sessionService.startMeeting(input),
    [IPC_CHANNELS.sessionStopMeeting]: async () => sessionService.stopMeeting(),
    [IPC_CHANNELS.sessionCopyLiveSession]: async () => sessionService.copyLiveSession(),
    [IPC_CHANNELS.sessionExportLiveSession]: async (format) => sessionService.exportLiveSession(format)
  }
}
