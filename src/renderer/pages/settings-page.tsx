import { useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react'

import type {
  AppSettings,
  EngineProfile,
  LocalServiceStatus,
  OutputMethod,
  ProfileTestResult,
  PttHotkey,
  SpeechLanguage,
  ThemeSetting,
  TranslationProvider
} from '../../shared/api-types'
import { Button, SelectField, TextInput } from '../ui/controls'
import {
  describeLocalServiceStatus,
  describeOutputMethod,
  describeProfileLabel,
  describeProfileSummary,
  describePttHotkey
} from '../ui/copy'

type SettingsSectionId = 'workspace' | 'dictation' | 'meetings' | 'translation' | 'recognition' | 'advanced'

type SettingsHeaderState =
  | { tone: 'saved'; label: string }
  | { tone: 'warning'; label: string }
  | { tone: 'danger'; label: string }
  | null

export function SettingsPage(props: {
  settings: AppSettings
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
  onLocalServiceHostChange: (host: string) => void
  onLocalServicePortChange: (port: number | undefined) => void
  onExportDiagnostics: () => void
}) {
  const sectionId = useId()
  const [selectedSection, setSelectedSection] = useState<SettingsSectionId>('workspace')
  const [draftHost, setDraftHost] = useState(props.settings.advanced.localServiceHost ?? '')
  const [draftPort, setDraftPort] = useState(props.settings.advanced.localServicePort?.toString() ?? '')
  const [showSavedState, setShowSavedState] = useState(false)
  const previousSettingsSignature = useRef<string | null>(null)
  const isCheckingProfile = props.busyAction?.startsWith('profile-test:') ?? false
  const disabled = Boolean(props.busyAction)
  const translationEnabled = props.settings.translation.enabledForPtt || props.settings.translation.enabledForMeeting
  const portValue = draftPort.trim()
  const invalidPort = portValue.length > 0 && !/^\d+$/.test(portValue)
  const selectedProfile = props.profiles.find((profile) => profile.id === props.settings.speech.selectedProfileId) ?? null

  useEffect(() => {
    setDraftHost(props.settings.advanced.localServiceHost ?? '')
    setDraftPort(props.settings.advanced.localServicePort?.toString() ?? '')
  }, [props.settings.advanced.localServiceHost, props.settings.advanced.localServicePort])

  useEffect(() => {
    const signature = JSON.stringify(props.settings)
    if (previousSettingsSignature.current === null) {
      previousSettingsSignature.current = signature
      return
    }

    if (previousSettingsSignature.current !== signature) {
      previousSettingsSignature.current = signature
      setShowSavedState(true)
      const timeoutId = window.setTimeout(() => setShowSavedState(false), 2200)
      return () => window.clearTimeout(timeoutId)
    }

    return
  }, [props.settings])

  const headerState = useMemo<SettingsHeaderState>(() => {
    if (selectedSection === 'recognition' && isCheckingProfile) {
      return { tone: 'warning', label: 'Checking profile' }
    }

    if (selectedSection === 'advanced' && invalidPort) {
      return { tone: 'danger', label: 'Invalid input' }
    }

    if (
      selectedSection === 'advanced' &&
      props.localServiceStatus !== 'healthy' &&
      props.localServiceStatus !== 'starting'
    ) {
      return { tone: 'warning', label: 'Service degraded' }
    }

    if (showSavedState) {
      return { tone: 'saved', label: 'Saved just now' }
    }

    return null
  }, [invalidPort, isCheckingProfile, props.localServiceStatus, selectedSection, showSavedState])

  const commitAdvancedHost = () => {
    if (draftHost === (props.settings.advanced.localServiceHost ?? '')) {
      return
    }

    props.onLocalServiceHostChange(draftHost.trim())
  }

  const commitAdvancedPort = () => {
    if (invalidPort) {
      return
    }

    const normalizedCurrent = props.settings.advanced.localServicePort?.toString() ?? ''
    if (portValue === normalizedCurrent) {
      return
    }

    props.onLocalServicePortChange(portValue ? Number.parseInt(portValue, 10) : undefined)
  }

  const selectedSectionMeta = describeSettingsSection(selectedSection)

  return (
    <div className="page page--settings">
      <div className="settings-layout">
        <aside className="settings-directory" aria-labelledby={`${sectionId}-directory`}>
          <div id={`${sectionId}-directory`} className="settings-directory__eyebrow">Sections</div>
          {SETTINGS_SECTIONS.map((section) => (
            <button
              key={section.id}
              type="button"
              className={`settings-directory__link ${selectedSection === section.id ? 'settings-directory__link--active' : ''} ${section.id === 'advanced' ? 'settings-directory__link--advanced' : ''}`}
              onClick={() => setSelectedSection(section.id)}
            >
              <span className="settings-directory__dot" aria-hidden="true" />
              <span>{section.label}</span>
            </button>
          ))}
        </aside>

        <section className="settings-content" aria-labelledby={`${sectionId}-title`}>
          <header className="surface-header surface-header--settings">
            <div className="surface-header__eyebrow">Settings</div>
            <div className="surface-header__row">
              <div className="surface-header__headline-group">
                <h1 id={`${sectionId}-title`} className="surface-header__title">{selectedSectionMeta.title}</h1>
              </div>
              <div className="surface-header__meta">
                {headerState ? (
                  <span className={`status-pill status-pill--${headerState.tone}`}>{headerState.label}</span>
                ) : null}
              </div>
            </div>
          </header>

          <div className="settings-sheet">
            {selectedSection === 'workspace' ? (
              <SettingsSection>
                <SettingRow title="App language" hint="The interface language for the desktop app.">
                  <SelectField
                    value={props.settings.general.language}
                    disabled={disabled}
                    onChange={(event) => props.onGeneralLanguageChange(event.target.value as AppSettings['general']['language'])}
                    className="field-select--wide"
                  >
                    <option value="zh-CN">Chinese (Simplified)</option>
                    <option value="en-US">English (US)</option>
                  </SelectField>
                </SettingRow>

                <SettingRow title="Theme" hint="Usually this should follow the operating system.">
                  <Segmented>
                    <Segment
                      active={props.settings.general.theme === 'system'}
                      disabled={disabled}
                      onClick={() => props.onThemeChange('system')}
                    >
                      Match system
                    </Segment>
                    <Segment
                      active={props.settings.general.theme === 'light'}
                      disabled={disabled}
                      onClick={() => props.onThemeChange('light')}
                    >
                      Light
                    </Segment>
                    <Segment
                      active={props.settings.general.theme === 'dark'}
                      disabled={disabled}
                      onClick={() => props.onThemeChange('dark')}
                    >
                      Dark
                    </Segment>
                  </Segmented>
                </SettingRow>

                <SettingRow title="Keep JustSay in the tray" hint="Useful if you want dictation and meetings ready without reopening the app." learnMore>
                  <ToggleButton
                    checked={props.settings.general.minimizeToTray}
                    disabled={disabled}
                    onClick={() => props.onMinimizeToTrayChange(!props.settings.general.minimizeToTray)}
                    onLabel="Enabled"
                    offLabel="Disabled"
                  />
                </SettingRow>
              </SettingsSection>
            ) : null}

            {selectedSection === 'dictation' ? (
              <SettingsSection>
                <SettingRow title="Push-to-talk key" hint="Pick the one least likely to conflict with your normal shortcuts.">
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
                </SettingRow>

                <SettingRow title="When dictation finishes" hint="Choose how the final text reaches the active app.">
                  <SelectField
                    value={props.settings.output.method}
                    disabled={disabled}
                    onChange={(event) => props.onOutputMethodChange(event.target.value as OutputMethod)}
                    className="field-select--wide"
                  >
                    <option value="simulate_input">{describeOutputMethod('simulate_input')}</option>
                    <option value="clipboard">{describeOutputMethod('clipboard')}</option>
                    <option value="popup">{describeOutputMethod('popup')}</option>
                  </SelectField>
                </SettingRow>
              </SettingsSection>
            ) : null}

            {selectedSection === 'meetings' ? (
              <SettingsSection>
                <SettingRow title="Speech language" hint="Leave this on auto unless your meetings stay in one language.">
                  <SelectField
                    value={props.settings.speech.language}
                    disabled={disabled}
                    onChange={(event) => props.onSpeechLanguageChange(event.target.value as SpeechLanguage)}
                    className="field-select--wide"
                  >
                    <option value="auto">Detect automatically</option>
                    <option value="zh">Chinese</option>
                    <option value="en">English</option>
                    <option value="ja">Japanese</option>
                    <option value="ko">Korean</option>
                  </SelectField>
                </SettingRow>

                <SettingRow title="Also capture your microphone" hint="Turn this on when your own voice should join the meeting transcript.">
                  <ToggleButton
                    checked={props.settings.input.includeMicrophoneInMeeting}
                    disabled={disabled}
                    onClick={() => props.onIncludeMicrophoneChange(!props.settings.input.includeMicrophoneInMeeting)}
                    onLabel="Included"
                    offLabel="System audio only"
                  />
                </SettingRow>
              </SettingsSection>
            ) : null}

            {selectedSection === 'translation' ? (
              <SettingsSection>
                <SettingRow title="Quick Dictation" hint="Keep this off unless you regularly dictate in one language and deliver in another.">
                  <ToggleButton
                    checked={props.settings.translation.enabledForPtt}
                    disabled={disabled}
                    onClick={() => props.onTranslatePttChange(!props.settings.translation.enabledForPtt)}
                    onLabel="Enabled"
                    offLabel="Off"
                  />
                </SettingRow>

                <SettingRow title="Live Session" hint="Useful for bilingual review after meetings, not just during capture.">
                  <ToggleButton
                    checked={props.settings.translation.enabledForMeeting}
                    disabled={disabled}
                    onClick={() => props.onTranslateMeetingChange(!props.settings.translation.enabledForMeeting)}
                    onLabel="Enabled"
                    offLabel="Off"
                  />
                </SettingRow>

                <SettingRow title="Translate to" hint="Use a language name or short code.">
                  <TextInput
                    value={props.settings.translation.targetLanguage}
                    disabled={disabled || !translationEnabled}
                    placeholder="en"
                    onChange={(event) => props.onTranslationTargetLanguageChange(event.target.value)}
                    className="field-input--wide"
                  />
                  {!translationEnabled ? (
                    <div className="field-note">Translation stays off until you enable it for dictation or meetings.</div>
                  ) : null}
                </SettingRow>

                <SettingRow title="Provider" hint="Current builds use the OpenAI-compatible translation path.">
                  <SelectField
                    value={props.settings.translation.provider}
                    disabled={disabled}
                    onChange={(event) => props.onTranslationProviderChange(event.target.value as TranslationProvider)}
                    className="field-select--wide"
                  >
                    <option value="openai-compatible">OpenAI-compatible</option>
                  </SelectField>
                </SettingRow>
              </SettingsSection>
            ) : null}

            {selectedSection === 'recognition' ? (
              <SettingsSection>
                <div className="settings-subhead">
                  <div className="settings-subhead__title">Available presets</div>
                  <div className="settings-subhead__body">
                    The current preset should read as the default answer. Alternatives stay visible, but quiet until you actively switch.
                  </div>
                </div>

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
                              {describeProfileLabel(profile)}
                              {isSelected ? <span className="preset-card__current">Current</span> : null}
                            </div>
                            <div className="preset-card__summary">{describeProfileSummary(profile)}</div>
                          </div>
                          <div className="preset-card__actions">
                            <Button
                              label={isSelected ? 'Current' : 'Use'}
                              disabled={disabled || isSelected}
                              size="small"
                              variant={isSelected ? 'secondary' : 'primary'}
                              onClick={() => props.onSelectProfile(profile.id)}
                            />
                            <Button
                              label={checking ? 'Checking...' : 'Check'}
                              disabled={disabled}
                              size="small"
                              variant="secondary"
                              onClick={() => props.onTestProfile(profile.id)}
                            />
                          </div>
                        </div>
                        {testResult ? (
                          <div className={`result-line ${testResult.ok ? '' : 'result-line--danger'}`}>
                            {describeProfileTestResult(testResult)}
                          </div>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              </SettingsSection>
            ) : null}

            {selectedSection === 'advanced' ? (
              <SettingsSection>
                <div className="advanced-summary">
                  <div className="advanced-summary__title">Local speech service</div>
                  <div className="advanced-summary__meta">
                    {describeLocalServiceStatus(props.localServiceStatus)}
                  </div>
                </div>

                <SettingRow title="Speech service host" hint="This usually stays on the machine itself." learnMore>
                  <TextInput
                    value={draftHost}
                    disabled={disabled}
                    placeholder="127.0.0.1"
                    onChange={(event) => setDraftHost(event.target.value)}
                    className="field-input--wide"
                  />
                  <div className="field-action-row">
                    <Button label="Save host" size="small" disabled={disabled} onClick={commitAdvancedHost} />
                  </div>
                </SettingRow>

                <SettingRow title="Speech service port" hint="A wrong value here can break dictation and meeting capture completely." learnMore>
                  <TextInput
                    value={draftPort}
                    disabled={disabled}
                    placeholder="8765"
                    inputMode="numeric"
                    onChange={(event) => setDraftPort(event.target.value)}
                    className={`field-input--wide ${invalidPort ? 'field-input--invalid' : ''}`}
                  />
                  <div className="field-action-row">
                    <Button label="Save port" size="small" disabled={disabled || invalidPort} onClick={commitAdvancedPort} />
                  </div>
                  {invalidPort ? (
                    <div className="field-note field-note--danger">Port must be numeric. The current value cannot be used.</div>
                  ) : null}
                </SettingRow>

                <SettingRow title="Diagnostics recording" hint="Only meaningful while troubleshooting. Keep it off otherwise.">
                  <div className="advanced-actions">
                    <div className="field-chip field-chip--quiet">
                      {props.settings.advanced.diagnosticsEnabled ? 'Enabled' : 'Disabled'}
                    </div>
                    <Button
                      label={props.busyAction === 'diagnostics-export' ? 'Exporting...' : 'Export diagnostic bundle'}
                      size="small"
                      variant="secondary"
                      disabled={disabled}
                      onClick={props.onExportDiagnostics}
                    />
                    {props.diagnosticsMessage ? <div className="field-note">{props.diagnosticsMessage}</div> : null}
                  </div>
                </SettingRow>

                <div className="advanced-warning">
                  Advanced stays visible so it can be found quickly, but it should feel lower-confidence than the rest of the page. Change it only when support asks you to, or while debugging a local setup.
                </div>

                <div className="settings-section__footer">
                  <button
                    type="button"
                    className="settings-reset"
                    disabled={disabled}
                    onClick={() => {
                      setDraftHost('127.0.0.1')
                      setDraftPort('8765')
                      props.onLocalServiceHostChange('127.0.0.1')
                      props.onLocalServicePortChange(8765)
                    }}
                  >
                    Reset to defaults
                  </button>
                </div>
              </SettingsSection>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  )
}

const SETTINGS_SECTIONS: Array<{ id: SettingsSectionId; label: string }> = [
  { id: 'workspace', label: 'Workspace' },
  { id: 'dictation', label: 'Dictation' },
  { id: 'meetings', label: 'Meetings' },
  { id: 'translation', label: 'Translation' },
  { id: 'recognition', label: 'Recognition' },
  { id: 'advanced', label: 'Advanced' }
]

function describeSettingsSection(section: SettingsSectionId) {
  switch (section) {
    case 'workspace':
      return { title: 'Workspace' }
    case 'dictation':
      return { title: 'Dictation' }
    case 'meetings':
      return { title: 'Meetings' }
    case 'translation':
      return { title: 'Translation' }
    case 'recognition':
      return { title: 'Recognition' }
    case 'advanced':
    default:
      return { title: 'Advanced' }
  }
}

function SettingsSection(props: { children: ReactNode }) {
  return <section className="settings-section">{props.children}</section>
}

function SettingRow(props: { title: string; hint: string; learnMore?: boolean; children: ReactNode }) {
  return (
    <div className="settings-row">
      <div className="settings-row__label">
        <div className="settings-row__title">{props.title}</div>
        <div className="settings-row__hint">
          {props.hint}
          {props.learnMore ? <> <span className="settings-help">Learn more</span></> : null}
        </div>
      </div>
      <div className="settings-row__control">{props.children}</div>
    </div>
  )
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

function ToggleButton(props: {
  checked: boolean
  disabled?: boolean
  onClick: () => void
  onLabel: string
  offLabel: string
}) {
  return (
    <button
      type="button"
      className={`toggle-button ${props.checked ? 'toggle-button--on' : 'toggle-button--off'}`}
      disabled={props.disabled}
      onClick={props.onClick}
      aria-pressed={props.checked}
    >
      <span className="toggle-button__track" aria-hidden="true" />
      <span>{props.checked ? props.onLabel : props.offLabel}</span>
    </button>
  )
}

function describeProfileTestResult(result: ProfileTestResult): string {
  if (!result.ok) {
    return result.error?.message ?? 'Check failed.'
  }

  if (result.localService) {
    return `${describeLocalServiceStatus(result.localService)}.`
  }

  return 'Preset ready.'
}
