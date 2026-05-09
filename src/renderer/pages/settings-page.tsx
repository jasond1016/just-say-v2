import { useId, type ChangeEvent, type ReactNode } from 'react'
import type {
  AppSettings,
  EngineProfile,
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

export function SettingsPage(props: {
  settings: AppSettings
  profiles: EngineProfile[]
  profileTests: Record<string, ProfileTestResult | undefined>
  diagnosticsMessage: string | null
  busyAction: string | null
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
  const disabled = Boolean(props.busyAction)
  const translationEnabled = props.settings.translation.enabledForPtt || props.settings.translation.enabledForMeeting
  const baseId = useId()
  const fieldId = (name: string) => `${baseId}-${name}`
  const selectedProfile = props.profiles.find((profile) => profile.id === props.settings.speech.selectedProfileId) ?? null

  return (
    <div className="page page--narrow">
      <h1 className="page-title">Settings</h1>

      <Section title="Workspace" description="Appearance and basic app behavior.">
        <Row label="App language" htmlFor={fieldId('language')}>
          <Select
            id={fieldId('language')}
            value={props.settings.general.language}
            disabled={disabled}
            onChange={(e) => props.onGeneralLanguageChange(e.target.value as AppSettings['general']['language'])}
          >
            <option value="zh-CN">Chinese (Simplified)</option>
            <option value="en-US">English (US)</option>
          </Select>
        </Row>
        <Row label="Theme" htmlFor={fieldId('theme')}>
          <Select
            id={fieldId('theme')}
            value={props.settings.general.theme}
            disabled={disabled}
            onChange={(e) => props.onThemeChange(e.target.value as ThemeSetting)}
          >
            <option value="system">Match system</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </Select>
        </Row>
        <Row label="Keep JustSay in the tray" htmlFor={fieldId('tray')}>
          <input
            id={fieldId('tray')}
            type="checkbox"
            checked={props.settings.general.minimizeToTray}
            disabled={disabled}
            onChange={(e) => props.onMinimizeToTrayChange(e.target.checked)}
          />
        </Row>
      </Section>

      <Section title="Dictation" description="Defaults for quick voice input.">
        <Row label="Push-to-talk key" htmlFor={fieldId('hotkey')}>
          <Select
            id={fieldId('hotkey')}
            value={props.settings.input.pttHotkey}
            disabled={disabled}
            onChange={(e) => props.onPttHotkeyChange(e.target.value as PttHotkey)}
          >
            <option value="RCtrl">{describePttHotkey('RCtrl')}</option>
            <option value="RAlt">{describePttHotkey('RAlt')}</option>
          </Select>
        </Row>
        <Row label="When dictation finishes" htmlFor={fieldId('output-method')}>
          <Select
            id={fieldId('output-method')}
            value={props.settings.output.method}
            disabled={disabled}
            onChange={(e) => props.onOutputMethodChange(e.target.value as OutputMethod)}
          >
            <option value="simulate_input">{describeOutputMethod('simulate_input')}</option>
            <option value="clipboard">{describeOutputMethod('clipboard')}</option>
            <option value="popup">{describeOutputMethod('popup')}</option>
          </Select>
        </Row>
      </Section>

      <Section title="Meetings" description="Defaults for live transcripts.">
        <Row label="Speech language" htmlFor={fieldId('speech-language')}>
          <Select
            id={fieldId('speech-language')}
            value={props.settings.speech.language}
            disabled={disabled}
            onChange={(e) => props.onSpeechLanguageChange(e.target.value as SpeechLanguage)}
          >
            <option value="auto">Detect automatically</option>
            <option value="zh">Chinese</option>
            <option value="en">English</option>
            <option value="ja">Japanese</option>
            <option value="ko">Korean</option>
          </Select>
        </Row>
        <Row label="Also capture your microphone" htmlFor={fieldId('meeting-microphone')}>
          <input
            id={fieldId('meeting-microphone')}
            type="checkbox"
            checked={props.settings.input.includeMicrophoneInMeeting}
            disabled={disabled}
            onChange={(e) => props.onIncludeMicrophoneChange(e.target.checked)}
          />
        </Row>
      </Section>

      <Section title="Translation" description="Show a second language under the original text when needed.">
        <Row label="Quick dictation" htmlFor={fieldId('translation-ptt')}>
          <input
            id={fieldId('translation-ptt')}
            type="checkbox"
            checked={props.settings.translation.enabledForPtt}
            disabled={disabled}
            onChange={(e) => props.onTranslatePttChange(e.target.checked)}
          />
        </Row>
        <Row label="Live session" htmlFor={fieldId('translation-meeting')}>
          <input
            id={fieldId('translation-meeting')}
            type="checkbox"
            checked={props.settings.translation.enabledForMeeting}
            disabled={disabled}
            onChange={(e) => props.onTranslateMeetingChange(e.target.checked)}
          />
        </Row>

        {translationEnabled ? (
          <>
            <Row label="Translate to" htmlFor={fieldId('translation-target')}>
              <Input
                id={fieldId('translation-target')}
                value={props.settings.translation.targetLanguage}
                disabled={disabled}
                placeholder="en"
                onChange={(e) => props.onTranslationTargetLanguageChange(e.target.value)}
              />
            </Row>
            <div className="settings-note">
              Use a language name or code, for example <code>English</code> or <code>en</code>.
            </div>
          </>
        ) : (
          <div className="settings-note">
            Translation stays off until you enable it for dictation or live sessions.
          </div>
        )}
      </Section>

      <Disclosure
        title="Recognition"
        summary={selectedProfile ? describeProfileLabel(selectedProfile) : 'Choose a recognition preset'}
        note="Only change this when you want a different speed or accuracy tradeoff."
      >
        {props.profiles.map((profile) => {
          const isSelected = props.settings.speech.selectedProfileId === profile.id
          const testResult = props.profileTests[profile.id]
          return (
            <div key={profile.id} className="settings-engine-item">
              <div className="settings-engine-item__head">
                <div className="settings-engine-item__copy">
                  <div>
                    <span className={`settings-engine-item__name ${isSelected ? 'settings-engine-item__name--active' : ''}`}>
                      {describeProfileLabel(profile)}
                    </span>
                    {isSelected ? (
                      <span className="settings-engine-item__active">Current</span>
                    ) : null}
                  </div>
                  <div className="settings-engine-item__summary">
                    {describeProfileSummary(profile)}
                  </div>
                </div>
                <div className="settings-engine-item__actions">
                  <Button
                    label={isSelected ? 'Current' : 'Use'}
                    disabled={disabled || isSelected}
                    size="small"
                    onClick={() => props.onSelectProfile(profile.id)}
                  />
                  <Button
                    label={props.busyAction === `profile-test:${profile.id}` ? 'Checking\u2026' : 'Check'}
                    disabled={disabled}
                    size="small"
                    variant="secondary"
                    onClick={() => props.onTestProfile(profile.id)}
                  />
                </div>
              </div>
              {testResult ? (
                <div className={`settings-engine-item__result ${testResult.ok ? 'text-success' : 'text-danger'}`}>
                  {describeProfileTestResult(testResult)}
                </div>
              ) : null}
            </div>
          )
        })}
      </Disclosure>

      <Disclosure
        title="Advanced"
        summary="Connection and diagnostics"
        note="Only change these if support asked you to, or while debugging a local setup."
      >
        <Row label="Speech service host" htmlFor={fieldId('service-host')}>
          <Input
            id={fieldId('service-host')}
            value={props.settings.advanced.localServiceHost ?? ''}
            disabled={disabled}
            placeholder="127.0.0.1"
            onChange={(e) => props.onLocalServiceHostChange(e.target.value)}
          />
        </Row>
        <Row label="Speech service port" htmlFor={fieldId('service-port')}>
          <Input
            id={fieldId('service-port')}
            value={props.settings.advanced.localServicePort?.toString() ?? ''}
            disabled={disabled}
            placeholder="8765"
            inputMode="numeric"
            onChange={(e) => {
              const trimmed = e.target.value.trim()
              props.onLocalServicePortChange(trimmed ? Number.parseInt(trimmed, 10) : undefined)
            }}
          />
        </Row>
        <Row label="Diagnostics recording">
          <span className="settings-row__value">
            {props.settings.advanced.diagnosticsEnabled ? 'Enabled' : 'Disabled'}
          </span>
        </Row>
        <div className="stack-8">
          <SmallButton
            label={props.busyAction === 'diagnostics-export' ? 'Exporting\u2026' : 'Export diagnostic bundle'}
            disabled={disabled}
            onClick={props.onExportDiagnostics}
          />
        </div>
        {props.diagnosticsMessage ? (
          <div className="caption-text stack-8">
            {props.diagnosticsMessage}
          </div>
        ) : null}
      </Disclosure>
    </div>
  )
}

function Section(props: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="settings-section">
      <h2 className="settings-section__title">{props.title}</h2>
      {props.description ? <p className="settings-section__description">{props.description}</p> : null}
      <div>{props.children}</div>
    </section>
  )
}

function Disclosure(props: { title: string; summary: string; note?: string; children: ReactNode }) {
  return (
    <details className="settings-disclosure">
      <summary className="settings-disclosure__summary">
        <span className="settings-disclosure__title">{props.title}</span>
        <span className="settings-disclosure__meta">{props.summary}</span>
      </summary>
      <div className="settings-disclosure__body">
        {props.note ? <div className="settings-note">{props.note}</div> : null}
        {props.children}
      </div>
    </details>
  )
}

function Row(props: { label: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="settings-row">
      <label className="settings-row__label" htmlFor={props.htmlFor}>
        {props.label}
      </label>
      {props.children}
    </div>
  )
}

function Select(props: {
  id?: string
  value: string
  disabled?: boolean
  onChange: (e: ChangeEvent<HTMLSelectElement>) => void
  children: ReactNode
}) {
  return (
    <SelectField
      id={props.id}
      value={props.value}
      disabled={props.disabled}
      onChange={props.onChange}
      className="field-select--compact"
    >
      {props.children}
    </SelectField>
  )
}

function Input(props: {
  id?: string
  value: string
  disabled?: boolean
  placeholder?: string
  inputMode?: 'text' | 'numeric'
  onChange: (e: ChangeEvent<HTMLInputElement>) => void
}) {
  return (
    <TextInput
      id={props.id}
      value={props.value}
      disabled={props.disabled}
      placeholder={props.placeholder}
      inputMode={props.inputMode}
      onChange={props.onChange}
      className="field-input--compact field-input--fixed"
    />
  )
}

function SmallButton(props: { label: string; disabled?: boolean; onClick: () => void }) {
  return (
    <Button
      label={props.label}
      disabled={props.disabled}
      size="small"
      onClick={props.onClick}
    />
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
