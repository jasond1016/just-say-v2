import type { ReactNode } from 'react'
import type { AppSettings, EngineProfile, ProfileTestResult } from '../../shared/api-types'

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
  onToggleTheme: () => void
  onSelectProfile: (profileId: string) => void
  onTestProfile: (profileId: string) => void
  onExportDiagnostics: () => void
}) {
  return (
    <section
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
        gap: 20
      }}
    >
      <SettingsCard title="General" palette={props.palette}>
        <SettingRow label="Language" value={props.settings.general.language} />
        <SettingRow label="Theme" value={props.settings.general.theme} />
        <button
          type="button"
          onClick={props.onToggleTheme}
          style={buttonStyle()}
        >
          Toggle Theme
        </button>
      </SettingsCard>

      <SettingsCard title="Speech Engine" palette={props.palette}>
        {props.profiles.map((profile) => (
          <article
            key={profile.id}
            style={{
              border: `1px solid ${props.palette.border}`,
              borderRadius: 18,
              padding: 14,
              background: props.settings.speech.selectedProfileId === profile.id ? props.palette.panel : props.palette.panelSoft,
              marginBottom: 12
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700 }}>{profile.label}</div>
                <div style={{ marginTop: 6, color: props.palette.muted }}>{profile.preset}</div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignContent: 'start' }}>
                <button type="button" onClick={() => props.onSelectProfile(profile.id)} style={buttonStyle()}>
                  Select
                </button>
                <button type="button" onClick={() => props.onTestProfile(profile.id)} style={buttonStyle()}>
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
        <SettingRow label="PTT Hotkey" value={props.settings.input.pttHotkey} />
        <SettingRow label="Output Method" value={props.settings.output.method} />
        <SettingRow label="Mic In Meeting" value={props.settings.input.includeMicrophoneInMeeting ? 'enabled' : 'disabled'} />
      </SettingsCard>

      <SettingsCard title="Language & Translation" palette={props.palette}>
        <SettingRow label="Speech Language" value={props.settings.speech.language} />
        <SettingRow label="Translate PTT" value={props.settings.translation.enabledForPtt ? 'on' : 'off'} />
        <SettingRow label="Translate Meeting" value={props.settings.translation.enabledForMeeting ? 'on' : 'off'} />
        <SettingRow label="Target Language" value={props.settings.translation.targetLanguage} />
      </SettingsCard>

      <SettingsCard title="Diagnostics" palette={props.palette}>
        <SettingRow
          label="Diagnostics"
          value={props.settings.advanced.diagnosticsEnabled ? 'enabled' : 'disabled'}
        />
        <button type="button" onClick={props.onExportDiagnostics} style={buttonStyle()}>
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

function SettingRow(props: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
      <span>{props.label}</span>
      <span style={{ fontWeight: 700 }}>{props.value}</span>
    </div>
  )
}

function buttonStyle() {
  return {
    border: '1px solid rgba(255, 255, 255, 0.12)',
    borderRadius: 999,
    padding: '10px 14px',
    background: 'transparent',
    color: 'inherit',
    cursor: 'pointer'
  } as const
}
