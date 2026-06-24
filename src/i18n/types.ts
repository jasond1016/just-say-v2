export type Messages = {
  // -- Navigation / Shell --
  navSpeak: string
  navSession: string
  navArchive: string
  navSettings: string

  // -- Speak page --
  speakSubtitle: string
  speakHoldToTalk: string
  speakRecentHeading: string
  speakRecentEmpty: string
  speakViewAllHistory: string
  speakCopyText: string
  speakDeleteText: string
  speakYesterday: (time: string) => string

  // -- Session page --
  sessionStopBusy: string
  sessionStop: string
  sessionStartBusy: string
  sessionStart: string
  sessionIdleHeading: string
  sessionFeatureSpeaker: string
  sessionFeatureBilingual: string
  sessionFeatureAutoSave: string
  sessionIdleHint: string
  sessionWaiting: string
  sessionJumpToLatest: string
  sessionStartNew: string
  sessionCopyBusy: string
  sessionCopyText: string
  sessionViewHistory: string

  // -- Archive page --
  archiveSearchPlaceholder: string
  archiveTabAll: string
  archiveTabMeeting: string
  archiveThTitle: string
  archiveThTime: string
  archiveThDuration: string
  archiveThType: string
  archiveTypeMeeting: string
  archiveBackToList: string
  archiveExport: string
  archiveArchived: string
  archiveTabTranscriptMeeting: string
  archiveTabTranscriptPtt: string
  archiveEmptyList: string
  archiveEmptyListHint: string
  archiveEmptyFilterHint: string
  archiveBulkSelectHint: string
  archiveBulkActionHint: string
  archiveBulkSelected: (count: number) => string
  archiveBulkExport: (count: number) => string
  archiveBulkDelete: (count: number) => string
  archiveBulkCancel: string
  archiveEmptyFilterBody: string
  archiveOpenQuickDictation: string
  archiveOpenLiveSession: string

  // -- Settings page --
  settingsAppTitle: string
  settingsLaunchAtLogin: string
  settingsMinimizeToTray: string
  settingsStartPage: string
  settingsStartPageSpeak: string
  settingsStartPageSession: string
  settingsThemeTitle: string
  settingsThemeMode: string
  settingsThemeSystem: string
  settingsThemeLight: string
  settingsThemeDark: string
  settingsFontSize: string
  settingsFontSmall: string
  settingsFontMedium: string
  settingsFontLarge: string
  settingsLanguageLabel: string
  settingsLanguageZh: string
  settingsLanguageEn: string
  settingsDataTitle: string
  settingsStoragePath: string
  settingsChooseFolder: string
  settingsAutoClean: string
  settingsAutoCleanNever: string
  settingsAutoClean30d: string
  settingsAutoClean90d: string
  settingsAboutTitle: string
  settingsVersion: string
  settingsCheckUpdate: string
  settingsUpToDate: string
  settingsFeedback: string
  settingsSendFeedback: string
  settingsRecordingTitle: string
  settingsSpeechLanguage: string
  settingsSpeechAuto: string
  settingsSpeechZh: string
  settingsMicInMeeting: string
  settingsTranslationTitle: string
  settingsPttTranslation: string
  settingsMeetingTranslation: string
  settingsTranslationTarget: string
  settingsTranslationService: string
  settingsTranslationTargetZh: string
  settingsTranslationTargetEn: string
  settingsTranslationTargetJa: string
  settingsEngineTitle: string
  settingsEngineCurrent: string
  settingsEngineUse: string
  settingsEngineTestBusy: string
  settingsEngineTest: string
  settingsShortcutsTitle: string
  settingsPttKey: string
  settingsOutputMethod: string
  settingsAdvancedSpeechTitle: string
  settingsDeployMode: string
  settingsDeployLocal: string
  settingsDeployRemote: string
  settingsLocalHost: string
  settingsLocalPort: string
  settingsRemoteHost: string
  settingsRemotePort: string
  settingsTranslationConfigTitle: string
  settingsTranslationEndpoint: string
  settingsTranslationModel: string
  settingsTranslationApiKey: string
  settingsDiagnosticsTitle: string
  settingsDiagnosticsLabel: string
  settingsDiagnosticsEnabled: string
  settingsDiagnosticsDisabled: string
  settingsExportDiagBusy: string
  settingsExportDiag: string
  settingsDiscard: string
  settingsSave: string
  settingsSaveTranslation: string
  settingsApiKeyPlaceholderSaved: string
  settingsTabGeneral: string
  settingsTabRecording: string
  settingsTabRecognition: string
  settingsTabShortcuts: string
  settingsTabAdvanced: string

  // -- Notifications --
  notificationActionNeeded: string
  notificationWarning: string
  notificationDismiss: string

  // -- copy.ts descriptions --
  copyOutputSimulate: string
  copyOutputClipboard: string
  copyOutputPopup: string
  copyServiceReady: string
  copyServiceStarting: string
  copyServiceNotReady: string
  copyServiceUnavailable: string
  copyServiceOffline: string

  // -- Notes (archive detail) --
  notesNotGenerated: string
  notesNotGeneratedTitle: string
  notesNotGeneratedBody: string
  notesGenerate: string
  notesLoading: string
  notesLoadingTitle: string
  notesLoadingBody: string
  notesGenerating: string
  notesGeneratingTitle: string
  notesGeneratingBody: string
  notesFailed: string
  notesFailedTitle: string
  notesTryAgain: string
  notesBackToTranscript: string
  notesOverview: string
  notesDecisions: string
  notesActionItems: string
  notesOpenQuestions: string
  archiveTabNotes: string

  // -- Misc --
  noMatchingLines: string

  // -- Engine profiles --
  profileLocalFast: string
  profileLocalAccurate: string
  profileCloudLowLatency: string
  profileCloudLowCost: string
  profileSummaryLocalFast: string
  profileSummaryLocalAccurate: string
  profileSummaryCloudLowLatency: string
  profileSummaryCloudLowCost: string
  profileTestFailed: string
  profileTestQwenWarming: string
  profileTestQwenReady: string
  profileTestQwenReadyLoaded: string
  profileTestQwenNeedPrewarm: string
  profileTestReady: string
}

export type AppLocale = 'zh-CN' | 'en-US'
