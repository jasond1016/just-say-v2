export const IPC_CHANNELS = {
  settingsGet: 'settings.get',
  settingsUpdate: 'settings.update',
  speechListProfiles: 'speech.listProfiles',
  speechTestProfile: 'speech.testProfile',
  sessionGetRuntime: 'session.getRuntime',
  sessionPrewarm: 'session.prewarm',
  sessionStartMeeting: 'session.startMeeting',
  sessionStopMeeting: 'session.stopMeeting',
  historyList: 'history.list',
  historySearch: 'history.search',
  historyGet: 'history.get',
  historyDelete: 'history.delete',
  historyExport: 'history.export',
  diagnosticsExport: 'diagnostics.export',
  runtimeSnapshot: 'runtime.snapshot',
  runtimeNotification: 'runtime.notification',
  settingsChanged: 'settings.changed'
} as const
