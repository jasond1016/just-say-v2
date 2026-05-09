import type { ChangeEvent, ReactNode } from 'react'
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

  return (
    <div style={{ maxWidth: 560 }}>
      <h1 style={{ fontSize: 24, fontWeight: 600, margin: 0 }}>Settings</h1>

      <Section title="General">
        <Row label="Language">
          <Select
            value={props.settings.general.language}
            disabled={disabled}
            onChange={(e) => props.onGeneralLanguageChange(e.target.value as AppSettings['general']['language'])}
          >
            <option value="zh-CN">Chinese (Simplified)</option>
            <option value="en-US">English (US)</option>
          </Select>
        </Row>
        <Row label="Theme">
          <Select
            value={props.settings.general.theme}
            disabled={disabled}
            onChange={(e) => props.onThemeChange(e.target.value as ThemeSetting)}
          >
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </Select>
        </Row>
        <Row label="Minimize to tray">
          <input
            type="checkbox"
            checked={props.settings.general.minimizeToTray}
            disabled={disabled}
            onChange={(e) => props.onMinimizeToTrayChange(e.target.checked)}
          />
        </Row>
      </Section>

      <Section title="Speech Engine">
        {props.profiles.map((profile) => {
          const isSelected = props.settings.speech.selectedProfileId === profile.id
          const testResult = props.profileTests[profile.id]
          return (
            <div key={profile.id} style={{
              padding: '10px 0',
              borderBottom: '1px solid var(--border-subtle)',
            }}>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 12,
              }}>
                <div>
                  <span style={{ fontWeight: isSelected ? 600 : 400, fontSize: 14 }}>
                    {profile.label}
                  </span>
                  <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--text-tertiary)' }}>
                    {profile.preset}
                  </span>
                  {isSelected ? (
                    <span style={{
                      marginLeft: 8,
                      fontSize: 11,
                      color: 'var(--accent-text)',
                      fontWeight: 500,
                    }}>
                      active
                    </span>
                  ) : null}
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <SmallButton
                    label="Select"
                    disabled={disabled || isSelected}
                    onClick={() => props.onSelectProfile(profile.id)}
                  />
                  <SmallButton
                    label={props.busyAction === `profile-test:${profile.id}` ? 'Testing\u2026' : 'Test'}
                    disabled={disabled}
                    onClick={() => props.onTestProfile(profile.id)}
                  />
                </div>
              </div>
              {testResult ? (
                <div style={{
                  marginTop: 6,
                  fontSize: 12,
                  color: testResult.ok ? 'var(--success)' : 'var(--danger)',
                }}>
                  {testResult.ok
                    ? `Ready ${'\u00B7'} local service: ${testResult.localService ?? 'n/a'}`
                    : testResult.error?.message ?? 'Test failed'}
                </div>
              ) : null}
            </div>
          )
        })}
      </Section>

      <Section title="Input & Output">
        <Row label="PTT Hotkey">
          <Select
            value={props.settings.input.pttHotkey}
            disabled={disabled}
            onChange={(e) => props.onPttHotkeyChange(e.target.value as PttHotkey)}
          >
            <option value="RCtrl">Right Ctrl</option>
            <option value="RAlt">Right Alt</option>
          </Select>
        </Row>
        <Row label="Output Method">
          <Select
            value={props.settings.output.method}
            disabled={disabled}
            onChange={(e) => props.onOutputMethodChange(e.target.value as OutputMethod)}
          >
            <option value="simulate_input">Simulate Input</option>
            <option value="clipboard">Clipboard</option>
            <option value="popup">Popup</option>
          </Select>
        </Row>
        <Row label="Mic in meetings">
          <input
            type="checkbox"
            checked={props.settings.input.includeMicrophoneInMeeting}
            disabled={disabled}
            onChange={(e) => props.onIncludeMicrophoneChange(e.target.checked)}
          />
        </Row>
      </Section>

      <Section title="Language & Translation">
        <Row label="Speech Language">
          <Select
            value={props.settings.speech.language}
            disabled={disabled}
            onChange={(e) => props.onSpeechLanguageChange(e.target.value as SpeechLanguage)}
          >
            <option value="auto">Auto</option>
            <option value="zh">Chinese</option>
            <option value="en">English</option>
            <option value="ja">Japanese</option>
            <option value="ko">Korean</option>
          </Select>
        </Row>
        <Row label="Translate dictation">
          <input
            type="checkbox"
            checked={props.settings.translation.enabledForPtt}
            disabled={disabled}
            onChange={(e) => props.onTranslatePttChange(e.target.checked)}
          />
        </Row>
        <Row label="Translate live session">
          <input
            type="checkbox"
            checked={props.settings.translation.enabledForMeeting}
            disabled={disabled}
            onChange={(e) => props.onTranslateMeetingChange(e.target.checked)}
          />
        </Row>
        <Row label="Target Language">
          <Input
            value={props.settings.translation.targetLanguage}
            disabled={disabled}
            onChange={(e) => props.onTranslationTargetLanguageChange(e.target.value)}
          />
        </Row>
        <Row label="Translation Provider">
          <Select
            value={props.settings.translation.provider}
            disabled={disabled}
            onChange={(e) => props.onTranslationProviderChange(e.target.value as TranslationProvider)}
          >
            <option value="openai-compatible">OpenAI Compatible</option>
          </Select>
        </Row>
      </Section>

      <Section title="Advanced">
        <Row label="Local Service Host">
          <Input
            value={props.settings.advanced.localServiceHost ?? ''}
            disabled={disabled}
            placeholder="127.0.0.1"
            onChange={(e) => props.onLocalServiceHostChange(e.target.value)}
          />
        </Row>
        <Row label="Local Service Port">
          <Input
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
        <Row label="Diagnostics">
          <span style={{ fontSize: 13, fontWeight: 500 }}>
            {props.settings.advanced.diagnosticsEnabled ? 'enabled' : 'disabled'}
          </span>
        </Row>
        <div style={{ marginTop: 8 }}>
          <SmallButton
            label={props.busyAction === 'diagnostics-export' ? 'Exporting\u2026' : 'Export Diagnostics'}
            disabled={disabled}
            onClick={props.onExportDiagnostics}
          />
        </div>
        {props.diagnosticsMessage ? (
          <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-tertiary)' }}>
            {props.diagnosticsMessage}
          </div>
        ) : null}
      </Section>
    </div>
  )
}

function Section(props: { title: string; children: ReactNode }) {
  return (
    <section style={{ marginTop: 28 }}>
      <h2 style={{
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: '0.04em',
        color: 'var(--text-tertiary)',
        textTransform: 'uppercase',
        margin: '0 0 12px',
      }}>
        {props.title}
      </h2>
      <div>{props.children}</div>
    </section>
  )
}

function Row(props: { label: string; children: ReactNode }) {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: 16,
      padding: '8px 0',
      borderBottom: '1px solid var(--border-subtle)',
      fontSize: 14,
    }}>
      <span style={{ color: 'var(--text-secondary)' }}>{props.label}</span>
      {props.children}
    </div>
  )
}

function Select(props: {
  value: string
  disabled?: boolean
  onChange: (e: ChangeEvent<HTMLSelectElement>) => void
  children: ReactNode
}) {
  return (
    <select value={props.value} disabled={props.disabled} onChange={props.onChange} style={{
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius)',
      padding: '5px 8px',
      background: 'var(--bg-surface)',
      color: 'var(--text-primary)',
      fontSize: 13,
      fontFamily: 'inherit',
    }}>
      {props.children}
    </select>
  )
}

function Input(props: {
  value: string
  disabled?: boolean
  placeholder?: string
  inputMode?: 'text' | 'numeric'
  onChange: (e: ChangeEvent<HTMLInputElement>) => void
}) {
  return (
    <input
      value={props.value}
      disabled={props.disabled}
      placeholder={props.placeholder}
      inputMode={props.inputMode}
      onChange={props.onChange}
      style={{
        width: 160,
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        padding: '5px 8px',
        background: 'var(--bg-surface)',
        color: 'var(--text-primary)',
        fontSize: 13,
        fontFamily: 'inherit',
      }}
    />
  )
}

function SmallButton(props: { label: string; disabled?: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={props.onClick} disabled={props.disabled} style={{
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius)',
      padding: '5px 10px',
      background: 'transparent',
      color: 'var(--text-secondary)',
      fontSize: 12,
      cursor: props.disabled ? 'not-allowed' : 'pointer',
      fontFamily: 'inherit',
      opacity: props.disabled ? 0.5 : 1,
    }}>
      {props.label}
    </button>
  )
}
