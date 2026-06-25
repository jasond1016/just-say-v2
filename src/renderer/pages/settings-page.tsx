import { useEffect, useState, type ReactNode } from 'react'

import type {
  AppSettings,
  EngineProfile,
  LocalServiceMode,
  LocalServiceStatus,
  OutputMethod,
  ProfileTestResult,
  PttHotkey,
  SpeechLanguage,
  ThemeSetting,
  TranslationProvider
} from '../../shared/api-types'
import type { Messages } from '../../i18n'
import type { SettingsSectionId } from '../app/app-model'
import { Button, SelectField } from '../ui/controls'
import {
  describeLocalServiceStatus,
  describeOutputMethod,
  describeProfileLabel,
  describeProfileSummary,
  describePttHotkey
} from '../ui/copy'
import { useT } from '../i18n-context'

export type TranslationTargetOption = 'zh' | 'en' | 'ja'

export const TRANSLATION_TARGET_OPTIONS: Array<{ value: TranslationTargetOption; labelKey: 'settingsTranslationTargetZh' | 'settingsTranslationTargetEn' | 'settingsTranslationTargetJa' }> = [
  { value: 'zh', labelKey: 'settingsTranslationTargetZh' },
  { value: 'en', labelKey: 'settingsTranslationTargetEn' },
  { value: 'ja', labelKey: 'settingsTranslationTargetJa' }
]

type TextSettingsDraft = {
  host: string
  port: string
}

export function SettingsPage(props: {
  settings: AppSettings
  initialSection?: SettingsSectionId
  profiles: EngineProfile[]
  profileTests: Record<string, ProfileTestResult | undefined>
  diagnosticsMessage: string | null
  busyAction: string | null
  localServiceStatus: LocalServiceStatus
  onGeneralLanguageChange: (language: AppSettings['general']['language']) => void
  onThemeChange: (theme: ThemeSetting) => void
  onMinimizeToTrayChange: (enabled: boolean) => void
  onSelectProfile: (profileId: string) => void
  onTestProfile: (profileId: string) => void
  onSpeechLanguageChange: (language: SpeechLanguage) => void
  onPttHotkeyChange: (hotkey: PttHotkey) => void
  onOutputMethodChange: (method: OutputMethod) => void
  onIncludeMicrophoneChange: (enabled: boolean) => void
  onTranslatePttChange: (enabled: boolean) => void
  onTranslateMeetingChange: (enabled: boolean) => void
  onTranslationTargetLanguageChange: (targetLanguage: string) => void
  onTranslationProviderChange: (provider: TranslationProvider) => void
  onTranslationEndpointChange: (endpoint: string) => void
  onTranslationModelChange: (model: string) => void
  onSaveTranslationApiKey: (apiKey: string) => Promise<void>
  onLocalServiceModeChange: (mode: LocalServiceMode) => void
  onLocalServiceHostChange: (host: string) => void
  onLocalServicePortChange: (port: number | undefined) => void
  onRemoteServiceHostChange: (host: string) => void
  onRemoteServicePortChange: (port: number | undefined) => void
  onExportDiagnostics: () => void
}) {
  const [selectedSection, setSelectedSection] = useState<SettingsSectionId>(props.initialSection ?? 'general')
  const [draftManagedHost, setDraftManagedHost] = useState(props.settings.advanced.localServiceHost ?? '')
  const [draftManagedPort, setDraftManagedPort] = useState(
    props.settings.advanced.localServicePort?.toString() ?? ''
  )
  const [draftRemoteHost, setDraftRemoteHost] = useState(props.settings.advanced.remoteServiceHost ?? '')
  const [draftRemotePort, setDraftRemotePort] = useState(
    props.settings.advanced.remoteServicePort?.toString() ?? ''
  )
  const [draftTranslationEndpoint, setDraftTranslationEndpoint] = useState(props.settings.translation.endpoint ?? '')
  const [draftTranslationModel, setDraftTranslationModel] = useState(props.settings.translation.model ?? '')
  const [draftTranslationApiKey, setDraftTranslationApiKey] = useState('')
  const t = useT()
  const disabled = Boolean(props.busyAction)
  const translationEnabled = props.settings.translation.enabledForPtt || props.settings.translation.enabledForMeeting
  const translationApiKeyConfigured = Boolean(props.settings.translation.apiKeyConfigured)
  const localServiceMode = props.settings.advanced.localServiceMode
  const managedPortValue = draftManagedPort.trim()
  const remotePortValue = draftRemotePort.trim()
  const invalidManagedPort = managedPortValue.length > 0 && !/^\d+$/.test(managedPortValue)
  const invalidRemotePort = remotePortValue.length > 0 && !/^\d+$/.test(remotePortValue)
  const selectedTranslationTarget = getTranslationTargetSelectValue(props.settings.translation.targetLanguage)
  const translationDraftDirty = hasTranslationDraftChanges(props.settings.translation, {
    endpoint: draftTranslationEndpoint,
    model: draftTranslationModel,
    apiKey: draftTranslationApiKey
  })
  const managedConnectionDraftDirty = hasConnectionDraftChanges(
    {
      host: props.settings.advanced.localServiceHost,
      port: props.settings.advanced.localServicePort
    },
    {
      host: draftManagedHost,
      port: draftManagedPort
    }
  )
  const remoteConnectionDraftDirty = hasConnectionDraftChanges(
    {
      host: props.settings.advanced.remoteServiceHost,
      port: props.settings.advanced.remoteServicePort
    },
    {
      host: draftRemoteHost,
      port: draftRemotePort
    }
  )
  const activeConnectionDraftDirty = localServiceMode === 'managed-local'
    ? managedConnectionDraftDirty
    : remoteConnectionDraftDirty

  useEffect(() => {
    setSelectedSection(props.initialSection ?? 'general')
  }, [props.initialSection])

  useEffect(() => {
    setDraftManagedHost(props.settings.advanced.localServiceHost ?? '')
    setDraftManagedPort(props.settings.advanced.localServicePort?.toString() ?? '')
    setDraftRemoteHost(props.settings.advanced.remoteServiceHost ?? '')
    setDraftRemotePort(props.settings.advanced.remoteServicePort?.toString() ?? '')
  }, [
    props.settings.advanced.localServiceHost,
    props.settings.advanced.localServicePort,
    props.settings.advanced.remoteServiceHost,
    props.settings.advanced.remoteServicePort
  ])

  useEffect(() => {
    setDraftTranslationEndpoint(props.settings.translation.endpoint ?? '')
    setDraftTranslationModel(props.settings.translation.model ?? '')
  }, [props.settings.translation.endpoint, props.settings.translation.model])

  const discardTranslationDrafts = () => {
    setDraftTranslationEndpoint(props.settings.translation.endpoint ?? '')
    setDraftTranslationModel(props.settings.translation.model ?? '')
    setDraftTranslationApiKey('')
  }

  const saveTranslationDrafts = async () => {
    const normalizedEndpoint = draftTranslationEndpoint.trim()
    const normalizedModel = draftTranslationModel.trim()
    const normalizedApiKey = draftTranslationApiKey.trim()

    if (normalizedEndpoint !== (props.settings.translation.endpoint ?? '')) {
      props.onTranslationEndpointChange(normalizedEndpoint)
    }

    if (normalizedModel !== (props.settings.translation.model ?? '')) {
      props.onTranslationModelChange(normalizedModel)
    }

    if (normalizedApiKey) {
      await props.onSaveTranslationApiKey(normalizedApiKey)
      setDraftTranslationApiKey('')
    }
  }

  const discardManagedConnectionDrafts = () => {
    setDraftManagedHost(props.settings.advanced.localServiceHost ?? '')
    setDraftManagedPort(props.settings.advanced.localServicePort?.toString() ?? '')
  }

  const discardRemoteConnectionDrafts = () => {
    setDraftRemoteHost(props.settings.advanced.remoteServiceHost ?? '')
    setDraftRemotePort(props.settings.advanced.remoteServicePort?.toString() ?? '')
  }

  const saveManagedConnectionDrafts = () => {
    if (invalidManagedPort) {
      return
    }

    const normalizedHost = draftManagedHost.trim()
    if (normalizedHost !== (props.settings.advanced.localServiceHost ?? '')) {
      props.onLocalServiceHostChange(normalizedHost)
    }

    if (managedPortValue !== (props.settings.advanced.localServicePort?.toString() ?? '')) {
      props.onLocalServicePortChange(
        managedPortValue ? Number.parseInt(managedPortValue, 10) : undefined
      )
    }
  }

  const saveRemoteConnectionDrafts = () => {
    if (invalidRemotePort) {
      return
    }

    const normalizedHost = draftRemoteHost.trim()
    if (normalizedHost !== (props.settings.advanced.remoteServiceHost ?? '')) {
      props.onRemoteServiceHostChange(normalizedHost)
    }

    if (remotePortValue !== (props.settings.advanced.remoteServicePort?.toString() ?? '')) {
      props.onRemoteServicePortChange(
        remotePortValue ? Number.parseInt(remotePortValue, 10) : undefined
      )
    }
  }

  return (
    <div className="page page--settings">
      <div className="settings-page">
        <h1 className="page-title">Settings</h1>

        <div className="settings-tabs" role="tablist">
          {SETTINGS_SECTIONS.map((section) => (
            <button
              key={section.id}
              type="button"
              role="tab"
              aria-selected={selectedSection === section.id}
              className={`settings-tabs__tab ${selectedSection === section.id ? 'settings-tabs__tab--active' : ''}`}
              onClick={() => setSelectedSection(section.id)}
            >
              {t[section.labelKey]}
            </button>
          ))}
        </div>

        <div className="settings-panel">
          {selectedSection === 'general' ? (
            <div className="settings-grid">
              {/* 应用设置 */}
              <div className="settings-card">
                <h2 className="settings-card__title">{t.settingsAppTitle}</h2>
                <div className="settings-card__body">
                  <CardRow label={t.settingsLaunchAtLogin}>
                    <ToggleSwitch
                      checked={props.settings.general.launchAtLogin}
                      disabled={disabled}
                      onClick={() => {/* launchAtLogin toggle - needs backend wiring */}}
                    />
                  </CardRow>
                  <CardRow label={t.settingsMinimizeToTray}>
                    <ToggleSwitch
                      checked={props.settings.general.minimizeToTray}
                      disabled={disabled}
                      onClick={() => props.onMinimizeToTrayChange(!props.settings.general.minimizeToTray)}
                    />
                  </CardRow>
                </div>
              </div>

              {/* 主题外观 */}
              <div className="settings-card">
                <h2 className="settings-card__title">{t.settingsThemeTitle}</h2>
                <div className="settings-card__body">
                  <CardRow label={t.settingsThemeMode}>
                    <SelectField
                      className="settings-select"
                      value={props.settings.general.theme}
                      disabled={disabled}
                      onChange={(e) => props.onThemeChange(e.target.value as ThemeSetting)}
                    >
                      <option value="system">{t.settingsThemeSystem}</option>
                      <option value="light">{t.settingsThemeLight}</option>
                      <option value="dark">{t.settingsThemeDark}</option>
                    </SelectField>
                  </CardRow>
                  <CardRow label={t.settingsLanguageLabel}>
                    <SelectField
                      className="settings-select"
                      value={props.settings.general.language}
                      disabled={disabled}
                      onChange={(e) => props.onGeneralLanguageChange(e.target.value as AppSettings['general']['language'])}
                    >
                      <option value="zh-CN">{t.settingsLanguageZh}</option>
                      <option value="en-US">{t.settingsLanguageEn}</option>
                    </SelectField>
                  </CardRow>
                </div>
              </div>

              {/* 关于 JustSay */}
              <div className="settings-card">
                <h2 className="settings-card__title">{t.settingsAboutTitle}</h2>
                <div className="settings-card__body">
                  <CardRow label={t.settingsVersion}>
                    <span className="settings-card__value">v1.0.0</span>
                  </CardRow>
                </div>
              </div>
            </div>
          ) : null}

          {selectedSection === 'recording' ? (
            <div className="settings-grid">
              <div className="settings-card settings-card--wide">
                <h2 className="settings-card__title">{t.settingsRecordingTitle}</h2>
                <div className="settings-card__body">
                  <CardRow label={t.settingsSpeechLanguage}>
                    <SelectField
                      className="settings-select"
                      value={props.settings.speech.language}
                      disabled={disabled}
                      onChange={(e) => props.onSpeechLanguageChange(e.target.value as SpeechLanguage)}
                    >
                      <option value="auto">{t.settingsSpeechAuto}</option>
                      <option value="zh">{t.settingsSpeechZh}</option>
                      <option value="en">English</option>
                      <option value="ja">日本語</option>
                      <option value="ko">한국어</option>
                    </SelectField>
                  </CardRow>
                  <CardRow label={t.settingsMicInMeeting}>
                    <ToggleSwitch
                      checked={props.settings.input.includeMicrophoneInMeeting}
                      disabled={disabled}
                      onClick={() => props.onIncludeMicrophoneChange(!props.settings.input.includeMicrophoneInMeeting)}
                    />
                  </CardRow>
                </div>
              </div>

              <div className="settings-card settings-card--wide">
                <h2 className="settings-card__title">{t.settingsTranslationTitle}</h2>
                <div className="settings-card__body">
                  <CardRow label={t.settingsPttTranslation}>
                    <ToggleSwitch
                      checked={props.settings.translation.enabledForPtt}
                      disabled={disabled}
                      onClick={() => props.onTranslatePttChange(!props.settings.translation.enabledForPtt)}
                    />
                  </CardRow>
                  <CardRow label={t.settingsMeetingTranslation}>
                    <ToggleSwitch
                      checked={props.settings.translation.enabledForMeeting}
                      disabled={disabled}
                      onClick={() => props.onTranslateMeetingChange(!props.settings.translation.enabledForMeeting)}
                    />
                  </CardRow>
                  <CardRow label={t.settingsTranslationTarget}>
                    <SelectField
                      className="settings-select"
                      value={selectedTranslationTarget}
                      disabled={disabled || !translationEnabled}
                      onChange={(e) => props.onTranslationTargetLanguageChange(e.target.value as TranslationTargetOption)}
                    >
                      {TRANSLATION_TARGET_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{t[option.labelKey]}</option>
                      ))}
                    </SelectField>
                  </CardRow>
                  <CardRow label={t.settingsTranslationService}>
                    <SelectField
                      className="settings-select"
                      value={props.settings.translation.provider}
                      disabled={disabled}
                      onChange={(e) => props.onTranslationProviderChange(e.target.value as TranslationProvider)}
                    >
                      <option value="openai-compatible">OpenAI-compatible</option>
                    </SelectField>
                  </CardRow>
                </div>
              </div>

              <div className="settings-card settings-card--wide">
                <h2 className="settings-card__title">{t.settingsTranslationConfigTitle}</h2>
                <div className="settings-card__body">
                  <CardRow label={t.settingsTranslationEndpoint}>
                    <input
                      type="text"
                      className="settings-text-input"
                      value={draftTranslationEndpoint}
                      disabled={disabled}
                      placeholder="https://api.openai.com/v1"
                      onChange={(e) => setDraftTranslationEndpoint(e.target.value)}
                    />
                  </CardRow>
                  <CardRow label={t.settingsTranslationModel}>
                    <input
                      type="text"
                      className="settings-text-input"
                      value={draftTranslationModel}
                      disabled={disabled}
                      placeholder="gpt-4o-mini"
                      onChange={(e) => setDraftTranslationModel(e.target.value)}
                    />
                  </CardRow>
                  <CardRow label={t.settingsTranslationApiKey}>
                    <input
                      type="password"
                      className="settings-text-input"
                      value={draftTranslationApiKey}
                      disabled={disabled}
                      placeholder={translationApiKeyConfigured ? t.settingsApiKeyPlaceholderSaved : 'sk-...'}
                      onChange={(e) => setDraftTranslationApiKey(e.target.value)}
                    />
                  </CardRow>
                  {translationDraftDirty ? (
                    <div className="settings-card__actions-row">
                      <Button label={t.settingsDiscard} size="small" variant="ghost" disabled={disabled} onClick={discardTranslationDrafts} />
                      <Button label={t.settingsSaveTranslation} size="small" disabled={disabled} onClick={() => { void saveTranslationDrafts() }} />
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}

          {selectedSection === 'recognition' ? (
            <div className="settings-grid">
              <div className="settings-card settings-card--full">
                <h2 className="settings-card__title">{t.settingsEngineTitle}</h2>
                <div className="settings-card__body">
                  <div className="preset-list">
                    {props.profiles.map((profile) => {
                      const isSelected = props.settings.speech.selectedProfileId === profile.id
                      const testResult = props.profileTests[profile.id]
                      const checking = props.busyAction === `profile-test:${profile.id}`

                      return (
                        <div key={profile.id} className="preset-card">
                          <div className="preset-card__row">
                            <div className="preset-card__copy">
                              <div className="preset-card__name">
                                {describeProfileLabel(profile, t)}
                                {isSelected ? <span className="preset-card__current">{t.settingsEngineCurrent}</span> : null}
                              </div>
                              <div className="preset-card__summary">{describeProfileSummary(profile, t)}</div>
                            </div>
                            <div className="preset-card__actions">
                              <Button
                                label={isSelected ? t.settingsEngineCurrent : t.settingsEngineUse}
                                disabled={disabled || isSelected}
                                size="small"
                                variant={isSelected ? 'secondary' : 'primary'}
                                onClick={() => props.onSelectProfile(profile.id)}
                              />
                              <Button
                                label={checking ? t.settingsEngineTestBusy : t.settingsEngineTest}
                                disabled={disabled}
                                size="small"
                                variant="secondary"
                                onClick={() => props.onTestProfile(profile.id)}
                              />
                            </div>
                          </div>
                          {testResult ? (
                            <div className={`result-line ${testResult.ok ? '' : 'result-line--danger'}`}>
                              {describeProfileTestResult(testResult, t)}
                            </div>
                          ) : null}
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>

              <div className="settings-card settings-card--wide">
                <h2 className="settings-card__title">{t.settingsAdvancedSpeechTitle}</h2>
                <div className="settings-card__body">
                  <div className="settings-card__status">
                    {describeLocalServiceStatus(props.localServiceStatus, t)}
                  </div>
                  <CardRow label={t.settingsDeployMode}>
                    <SelectField
                      className="settings-select"
                      value={localServiceMode}
                      disabled={disabled}
                      onChange={(e) => props.onLocalServiceModeChange(e.target.value as LocalServiceMode)}
                    >
                      <option value="managed-local">{t.settingsDeployLocal}</option>
                      <option value="remote-service">{t.settingsDeployRemote}</option>
                    </SelectField>
                  </CardRow>

                  {localServiceMode === 'managed-local' ? (
                    <>
                      <CardRow label={t.settingsLocalHost}>
                        <input
                          type="text"
                          className="settings-text-input"
                          value={draftManagedHost}
                          disabled={disabled}
                          placeholder="127.0.0.1"
                          onChange={(e) => setDraftManagedHost(e.target.value)}
                        />
                      </CardRow>
                      <CardRow label={t.settingsLocalPort}>
                        <input
                          type="text"
                          className={`settings-text-input ${invalidManagedPort ? 'settings-text-input--invalid' : ''}`}
                          value={draftManagedPort}
                          disabled={disabled}
                          placeholder="8765"
                          inputMode="numeric"
                          onChange={(e) => setDraftManagedPort(e.target.value)}
                        />
                      </CardRow>
                      {managedConnectionDraftDirty ? (
                        <div className="settings-card__actions-row">
                          <Button label={t.settingsDiscard} size="small" variant="ghost" disabled={disabled} onClick={discardManagedConnectionDrafts} />
                          <Button label={t.settingsSave} size="small" disabled={disabled || invalidManagedPort} onClick={saveManagedConnectionDrafts} />
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <CardRow label={t.settingsRemoteHost}>
                        <input
                          type="text"
                          className="settings-text-input"
                          value={draftRemoteHost}
                          disabled={disabled}
                          placeholder="10.0.0.8"
                          onChange={(e) => setDraftRemoteHost(e.target.value)}
                        />
                      </CardRow>
                      <CardRow label={t.settingsRemotePort}>
                        <input
                          type="text"
                          className={`settings-text-input ${invalidRemotePort ? 'settings-text-input--invalid' : ''}`}
                          value={draftRemotePort}
                          disabled={disabled}
                          placeholder="8765"
                          inputMode="numeric"
                          onChange={(e) => setDraftRemotePort(e.target.value)}
                        />
                      </CardRow>
                      {remoteConnectionDraftDirty ? (
                        <div className="settings-card__actions-row">
                          <Button label={t.settingsDiscard} size="small" variant="ghost" disabled={disabled} onClick={discardRemoteConnectionDrafts} />
                          <Button label={t.settingsSave} size="small" disabled={disabled || invalidRemotePort} onClick={saveRemoteConnectionDrafts} />
                        </div>
                      ) : null}
                    </>
                  )}
                </div>
              </div>
            </div>
          ) : null}

          {selectedSection === 'shortcuts' ? (
            <div className="settings-grid">
              <div className="settings-card settings-card--wide">
                <h2 className="settings-card__title">{t.settingsShortcutsTitle}</h2>
                <div className="settings-card__body">
                  <CardRow label={t.settingsPttKey}>
                    <Segmented>
                      <Segment
                        active={props.settings.input.pttHotkey === 'RCtrl'}
                        disabled={disabled}
                        onClick={() => props.onPttHotkeyChange('RCtrl')}
                      >
                        {describePttHotkey('RCtrl')}
                      </Segment>
                      <Segment
                        active={props.settings.input.pttHotkey === 'RAlt'}
                        disabled={disabled}
                        onClick={() => props.onPttHotkeyChange('RAlt')}
                      >
                        {describePttHotkey('RAlt')}
                      </Segment>
                    </Segmented>
                  </CardRow>
                  <CardRow label={t.settingsOutputMethod}>
                    <SelectField
                      className="settings-select"
                      value={props.settings.output.method}
                      disabled={disabled}
                      onChange={(e) => props.onOutputMethodChange(e.target.value as OutputMethod)}
                    >
                      <option value="simulate_input">{describeOutputMethod('simulate_input', t)}</option>
                      <option value="clipboard">{describeOutputMethod('clipboard', t)}</option>
                      <option value="popup">{describeOutputMethod('popup', t)}</option>
                    </SelectField>
                  </CardRow>
                </div>
              </div>
            </div>
          ) : null}

          {selectedSection === 'advanced' ? (
            <div className="settings-grid">
              <div className="settings-card">
                <h2 className="settings-card__title">{t.settingsDiagnosticsTitle}</h2>
                <div className="settings-card__body">
                  <CardRow label={t.settingsDiagnosticsLabel}>
                    <span className="settings-card__value">
                      {props.settings.advanced.diagnosticsEnabled ? t.settingsDiagnosticsEnabled : t.settingsDiagnosticsDisabled}
                    </span>
                  </CardRow>
                  <div className="settings-card__actions-row">
                    <Button
                      label={props.busyAction === 'diagnostics-export' ? t.settingsExportDiagBusy : t.settingsExportDiag}
                      size="small"
                      variant="secondary"
                      disabled={disabled}
                      onClick={props.onExportDiagnostics}
                    />
                  </div>
                  {props.diagnosticsMessage ? <div className="settings-card__note">{props.diagnosticsMessage}</div> : null}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

const SETTINGS_SECTIONS: Array<{ id: SettingsSectionId; labelKey: 'settingsTabGeneral' | 'settingsTabRecording' | 'settingsTabRecognition' | 'settingsTabShortcuts' | 'settingsTabAdvanced' }> = [
  { id: 'general', labelKey: 'settingsTabGeneral' },
  { id: 'recording', labelKey: 'settingsTabRecording' },
  { id: 'recognition', labelKey: 'settingsTabRecognition' },
  { id: 'shortcuts', labelKey: 'settingsTabShortcuts' },
  { id: 'advanced', labelKey: 'settingsTabAdvanced' }
]

function CardRow(props: { label: string; children: ReactNode }) {
  return (
    <div className="settings-card__row-item">
      <span className="settings-card__row-label">{props.label}</span>
      <span className="settings-card__row-control">{props.children}</span>
    </div>
  )
}

function ToggleSwitch(props: { checked: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className={`toggle-switch ${props.checked ? 'toggle-switch--on' : ''}`}
      disabled={props.disabled}
      onClick={props.onClick}
      aria-pressed={props.checked}
    >
      <span className="toggle-switch__track">
        <span className="toggle-switch__thumb" />
      </span>
    </button>
  )
}

export function hasTranslationDraftChanges(
  translation: AppSettings['translation'],
  draft: { endpoint: string; model: string; apiKey: string }
): boolean {
  return (
    draft.endpoint.trim() !== (translation.endpoint ?? '') ||
    draft.model.trim() !== (translation.model ?? '') ||
    draft.apiKey.trim().length > 0
  )
}

export function hasConnectionDraftChanges(
  saved: { host: string | undefined; port: number | undefined },
  draft: TextSettingsDraft
): boolean {
  return (
    draft.host.trim() !== (saved.host ?? '') ||
    draft.port.trim() !== (saved.port?.toString() ?? '')
  )
}

export function getTranslationTargetSelectValue(targetLanguage: string): TranslationTargetOption {
  const normalized = targetLanguage.trim().toLowerCase()

  switch (normalized) {
    case 'zh':
    case 'zh-cn':
    case 'cn':
    case 'chinese':
      return 'zh'
    case 'ja':
    case 'ja-jp':
    case 'jp':
    case 'japanese':
      return 'ja'
    case 'en':
    case 'en-us':
    case 'english':
    default:
      return 'en'
  }
}

function Segmented(props: { children: ReactNode }) {
  return <div className="segmented">{props.children}</div>
}

function Segment(props: { active: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      className={`segment ${props.active ? 'segment--active' : ''}`}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  )
}

function describeProfileTestResult(result: ProfileTestResult, t: Messages): string {
  if (!result.ok) {
    return result.error?.message ?? t.profileTestFailed
  }

  if (result.runtimeIdentity?.runtimeFamilyId === 'qwen3-asr') {
    if (result.runtimeReadiness === 'warming') {
      return t.profileTestQwenWarming
    }

    if (result.runtimeReadiness === 'ready') {
      return result.prewarmTriggered
        ? t.profileTestQwenReadyLoaded
        : t.profileTestQwenReady
    }

    return t.profileTestQwenNeedPrewarm
  }

  if (result.localService) {
    return `${describeLocalServiceStatus(result.localService, t)}.`
  }

  return t.profileTestReady
}
