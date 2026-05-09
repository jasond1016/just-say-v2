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

type Palette = {
  panel: string
  panelSoft: string
  text: string
  muted: string
  border: string
}

export function SettingsPage(props: {
  settings: AppSettings
  profiles: EngineProfile[]
  profileTests: Record<string, ProfileTestResult | undefined>
  diagnosticsMessage: string | null
  busyAction: string | null
  palette: Palette
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
  const controlsDisabled = Boolean(props.busyAction)

  return (
    <section
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
        gap: 20
      }}
    >
      <SettingsCard title="General" palette={props.palette}>
        <FieldLabel label="Language">
          <SelectField
            value={props.settings.general.language}
            disabled={controlsDisabled}
            onChange={(event) => {
              props.onGeneralLanguageChange(event.target.value as AppSettings['general']['language'])
            }}
          >
            <option value="zh-CN">Chinese (Simplified)</option>
            <option value="en-US">English (US)</option>
          </SelectField>
        </FieldLabel>
        <FieldLabel label="Theme">
          <SelectField
            value={props.settings.general.theme}
            disabled={controlsDisabled}
            onChange={(event) => {
              props.onThemeChange(event.target.value as ThemeSetting)
            }}
          >
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </SelectField>
        </FieldLabel>
        <CheckboxField
          label="Minimize main window to tray"
          checked={props.settings.general.minimizeToTray}
          disabled={controlsDisabled}
          onChange={(event) => {
            props.onMinimizeToTrayChange(event.target.checked)
          }}
        />
      </SettingsCard>

      <SettingsCard title="Speech Engine" palette={props.palette}>
        {props.profiles.map((profile) => (
          <article
            key={profile.id}
            style={{
              border: `1px solid ${props.palette.border}`,
              borderRadius: 18,
              padding: 14,
              background:
                props.settings.speech.selectedProfileId === profile.id
                  ? props.palette.panel
                  : props.palette.panelSoft,
              marginBottom: 12
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700 }}>{profile.label}</div>
                <div style={{ marginTop: 6, color: props.palette.muted }}>{profile.preset}</div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignContent: 'start' }}>
                <button
                  type="button"
                  disabled={controlsDisabled}
                  onClick={() => props.onSelectProfile(profile.id)}
                  style={buttonStyle(Boolean(controlsDisabled))}
                >
                  Select
                </button>
                <button
                  type="button"
                  disabled={controlsDisabled}
                  onClick={() => props.onTestProfile(profile.id)}
                  style={buttonStyle(Boolean(controlsDisabled))}
                >
                  {props.busyAction === `profile-test:${profile.id}` ? 'Testing...' : 'Test'}
                </button>
              </div>
            </div>
            {props.profileTests[profile.id] ? (
              <div style={{ marginTop: 10, color: props.palette.muted }}>
                {props.profileTests[profile.id]?.ok
                  ? `Ready • local service: ${props.profileTests[profile.id]?.localService ?? 'n/a'}`
                  : props.profileTests[profile.id]?.error?.message ?? 'Test failed'}
              </div>
            ) : null}
          </article>
        ))}
      </SettingsCard>

      <SettingsCard title="Input & Output" palette={props.palette}>
        <FieldLabel label="PTT Hotkey">
          <SelectField
            value={props.settings.input.pttHotkey}
            disabled={controlsDisabled}
            onChange={(event) => {
              props.onPttHotkeyChange(event.target.value as PttHotkey)
            }}
          >
            <option value="RCtrl">Right Ctrl</option>
            <option value="RAlt">Right Alt</option>
          </SelectField>
        </FieldLabel>
        <FieldLabel label="Output Method">
          <SelectField
            value={props.settings.output.method}
            disabled={controlsDisabled}
            onChange={(event) => {
              props.onOutputMethodChange(event.target.value as OutputMethod)
            }}
          >
            <option value="simulate_input">Simulate Input</option>
            <option value="clipboard">Clipboard</option>
            <option value="popup">Popup</option>
          </SelectField>
        </FieldLabel>
        <CheckboxField
          label="Include microphone in meetings"
          checked={props.settings.input.includeMicrophoneInMeeting}
          disabled={controlsDisabled}
          onChange={(event) => {
            props.onIncludeMicrophoneChange(event.target.checked)
          }}
        />
      </SettingsCard>

      <SettingsCard title="Language & Translation" palette={props.palette}>
        <FieldLabel label="Speech Language">
          <SelectField
            value={props.settings.speech.language}
            disabled={controlsDisabled}
            onChange={(event) => {
              props.onSpeechLanguageChange(event.target.value as SpeechLanguage)
            }}
          >
            <option value="auto">Auto</option>
            <option value="zh">Chinese</option>
            <option value="en">English</option>
            <option value="ja">Japanese</option>
            <option value="ko">Korean</option>
          </SelectField>
        </FieldLabel>
        <CheckboxField
          label="Translate quick dictation"
          checked={props.settings.translation.enabledForPtt}
          disabled={controlsDisabled}
          onChange={(event) => {
            props.onTranslatePttChange(event.target.checked)
          }}
        />
        <CheckboxField
          label="Translate live session"
          checked={props.settings.translation.enabledForMeeting}
          disabled={controlsDisabled}
          onChange={(event) => {
            props.onTranslateMeetingChange(event.target.checked)
          }}
        />
        <FieldLabel label="Target Language">
          <TextField
            value={props.settings.translation.targetLanguage}
            disabled={controlsDisabled}
            onChange={(event) => {
              props.onTranslationTargetLanguageChange(event.target.value)
            }}
          />
        </FieldLabel>
        <FieldLabel label="Translation Provider">
          <SelectField
            value={props.settings.translation.provider}
            disabled={controlsDisabled}
            onChange={(event) => {
              props.onTranslationProviderChange(event.target.value as TranslationProvider)
            }}
          >
            <option value="openai-compatible">OpenAI Compatible</option>
          </SelectField>
        </FieldLabel>
      </SettingsCard>

      <SettingsCard title="Advanced" palette={props.palette}>
        <FieldLabel label="Local Service Host">
          <TextField
            value={props.settings.advanced.localServiceHost ?? ''}
            disabled={controlsDisabled}
            placeholder="127.0.0.1"
            onChange={(event) => {
              props.onLocalServiceHostChange(event.target.value)
            }}
          />
        </FieldLabel>
        <FieldLabel label="Local Service Port">
          <TextField
            value={props.settings.advanced.localServicePort?.toString() ?? ''}
            disabled={controlsDisabled}
            placeholder="8765"
            inputMode="numeric"
            onChange={(event) => {
              const trimmed = event.target.value.trim()
              props.onLocalServicePortChange(trimmed ? Number.parseInt(trimmed, 10) : undefined)
            }}
          />
        </FieldLabel>
        <SettingRow
          label="Diagnostics"
          value={props.settings.advanced.diagnosticsEnabled ? 'enabled' : 'disabled'}
        />
        <button
          type="button"
          onClick={props.onExportDiagnostics}
          disabled={controlsDisabled}
          style={buttonStyle(Boolean(controlsDisabled))}
        >
          {props.busyAction === 'diagnostics-export' ? 'Exporting...' : 'Export Diagnostics'}
        </button>
        {props.diagnosticsMessage ? (
          <div style={{ marginTop: 12, color: props.palette.muted }}>{props.diagnosticsMessage}</div>
        ) : null}
      </SettingsCard>
    </section>
  )
}

function SettingsCard(props: { title: string; palette: Palette; children: ReactNode }) {
  return (
    <article
      style={{
        border: `1px solid ${props.palette.border}`,
        background: props.palette.panelSoft,
        borderRadius: 28,
        padding: 24
      }}
    >
      <div style={{ fontSize: 12, letterSpacing: '0.16em', textTransform: 'uppercase', color: props.palette.muted }}>
        {props.title}
      </div>
      <div style={{ marginTop: 18 }}>{props.children}</div>
    </article>
  )
}

function FieldLabel(props: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: 'grid', gap: 8, marginBottom: 14 }}>
      <span>{props.label}</span>
      {props.children}
    </label>
  )
}

function SettingRow(props: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
      <span>{props.label}</span>
      <span style={{ fontWeight: 700 }}>{props.value}</span>
    </div>
  )
}

function CheckboxField(props: {
  label: string
  checked: boolean
  disabled?: boolean
  onChange: (event: ChangeEvent<HTMLInputElement>) => void
}) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
      <input type="checkbox" checked={props.checked} disabled={props.disabled} onChange={props.onChange} />
      <span>{props.label}</span>
    </label>
  )
}

function SelectField(props: {
  value: string
  disabled?: boolean
  onChange: (event: ChangeEvent<HTMLSelectElement>) => void
  children: ReactNode
}) {
  return (
    <select
      value={props.value}
      disabled={props.disabled}
      onChange={props.onChange}
      style={inputStyle(Boolean(props.disabled))}
    >
      {props.children}
    </select>
  )
}

function TextField(props: {
  value: string
  disabled?: boolean
  placeholder?: string
  inputMode?: 'text' | 'numeric'
  onChange: (event: ChangeEvent<HTMLInputElement>) => void
}) {
  return (
    <input
      value={props.value}
      disabled={props.disabled}
      placeholder={props.placeholder}
      inputMode={props.inputMode}
      onChange={props.onChange}
      style={inputStyle(Boolean(props.disabled))}
    />
  )
}

function inputStyle(disabled: boolean) {
  return {
    width: '100%',
    borderRadius: 14,
    border: '1px solid rgba(255, 255, 255, 0.12)',
    padding: '10px 12px',
    background: disabled ? 'rgba(120, 130, 145, 0.12)' : 'rgba(255, 255, 255, 0.03)',
    color: 'inherit'
  } as const
}

function buttonStyle(disabled: boolean) {
  return {
    border: '1px solid rgba(255, 255, 255, 0.12)',
    borderRadius: 999,
    padding: '10px 14px',
    background: 'transparent',
    color: 'inherit',
    cursor: disabled ? 'not-allowed' : 'pointer'
  } as const
}
