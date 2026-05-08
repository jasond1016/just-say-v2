import type {
  AppSettings,
  OutputMethod,
  PttHotkey,
  SettingsPatch,
  SpeechLanguage,
  ThemeSetting,
  TranslationProvider
} from '../../shared/api-types'
import { getProfileById, profileCatalog } from './profile-catalog'

export const DEFAULT_SETTINGS: AppSettings = {
  general: {
    language: 'zh-CN',
    theme: 'system',
    launchAtLogin: false,
    minimizeToTray: true
  },
  speech: {
    selectedProfileId: 'local-fast',
    language: 'auto'
  },
  input: {
    pttHotkey: 'RCtrl',
    includeMicrophoneInMeeting: false,
    microphoneDeviceId: 'default'
  },
  output: {
    method: 'simulate_input'
  },
  translation: {
    enabledForPtt: false,
    enabledForMeeting: false,
    targetLanguage: 'en',
    provider: 'openai-compatible'
  },
  advanced: {
    diagnosticsEnabled: true,
    experimentalFlags: []
  }
}

export const defaultSettings = DEFAULT_SETTINGS

const APP_LANGUAGES = new Set<AppSettings['general']['language']>(['zh-CN', 'en-US'])
const THEME_SETTINGS = new Set<ThemeSetting>(['system', 'light', 'dark'])
const SPEECH_LANGUAGES = new Set<SpeechLanguage>(['auto', 'zh', 'en', 'ja', 'ko'])
const PTT_HOTKEYS = new Set<PttHotkey>(['RCtrl', 'RAlt'])
const OUTPUT_METHODS = new Set<OutputMethod>(['simulate_input', 'clipboard', 'popup'])
const TRANSLATION_PROVIDERS = new Set<TranslationProvider>(['openai-compatible'])
const DEFAULT_LOCAL_SERVICE_PORT = 8765

export function createDefaultSettings(): AppSettings {
  return cloneSettings(DEFAULT_SETTINGS)
}

export function normalizeSettings(patch?: SettingsPatch): AppSettings {
  const merged = mergeSettings(DEFAULT_SETTINGS, patch)

  const selectedProfileId = getProfileById(merged.speech.selectedProfileId)
    ? merged.speech.selectedProfileId
    : DEFAULT_SETTINGS.speech.selectedProfileId
  const microphoneDeviceId =
    typeof merged.input.microphoneDeviceId === 'string' && merged.input.microphoneDeviceId.trim()
      ? merged.input.microphoneDeviceId.trim()
      : DEFAULT_SETTINGS.input.microphoneDeviceId
  const targetLanguage = normalizeNonEmptyString(
    merged.translation.targetLanguage,
    DEFAULT_SETTINGS.translation.targetLanguage
  )
  const localServiceHost = normalizeOptionalString(merged.advanced.localServiceHost)
  const localServicePort = normalizePort(merged.advanced.localServicePort)

  return {
    general: {
      language: APP_LANGUAGES.has(merged.general.language)
        ? merged.general.language
        : DEFAULT_SETTINGS.general.language,
      theme: THEME_SETTINGS.has(merged.general.theme)
        ? merged.general.theme
        : DEFAULT_SETTINGS.general.theme,
      launchAtLogin: merged.general.launchAtLogin,
      minimizeToTray: merged.general.minimizeToTray
    },
    speech: {
      selectedProfileId,
      language: SPEECH_LANGUAGES.has(merged.speech.language)
        ? merged.speech.language
        : DEFAULT_SETTINGS.speech.language
    },
    input: {
      pttHotkey: PTT_HOTKEYS.has(merged.input.pttHotkey)
        ? merged.input.pttHotkey
        : DEFAULT_SETTINGS.input.pttHotkey,
      includeMicrophoneInMeeting: merged.input.includeMicrophoneInMeeting,
      microphoneDeviceId
    },
    output: {
      method: OUTPUT_METHODS.has(merged.output.method)
        ? merged.output.method
        : DEFAULT_SETTINGS.output.method
    },
    translation: {
      enabledForPtt: merged.translation.enabledForPtt,
      enabledForMeeting: merged.translation.enabledForMeeting,
      targetLanguage,
      provider: TRANSLATION_PROVIDERS.has(merged.translation.provider)
        ? merged.translation.provider
        : DEFAULT_SETTINGS.translation.provider
    },
    advanced: {
      diagnosticsEnabled: merged.advanced.diagnosticsEnabled,
      experimentalFlags: normalizeExperimentalFlags(merged.advanced.experimentalFlags),
      ...(localServiceHost !== undefined ? { localServiceHost } : {}),
      ...(localServicePort !== undefined ? { localServicePort } : {})
    }
  }
}

export function applySettingsPatch(current: AppSettings, patch: SettingsPatch): AppSettings {
  return normalizeSettings(mergeSettings(current, patch))
}

function mergeSettings(base: AppSettings, patch?: SettingsPatch): AppSettings {
  if (!patch) {
    return cloneSettings(base)
  }

  return {
    general: {
      ...base.general,
      ...patch.general
    },
    speech: {
      ...base.speech,
      ...patch.speech
    },
    input: {
      ...base.input,
      ...patch.input
    },
    output: {
      ...base.output,
      ...patch.output
    },
    translation: {
      ...base.translation,
      ...patch.translation
    },
    advanced: {
      ...base.advanced,
      ...patch.advanced,
      experimentalFlags: patch.advanced?.experimentalFlags
        ? [...patch.advanced.experimentalFlags]
        : [...base.advanced.experimentalFlags]
    }
  }
}

function cloneSettings(settings: AppSettings): AppSettings {
  return {
    general: {
      ...settings.general
    },
    speech: {
      ...settings.speech
    },
    input: {
      ...settings.input
    },
    output: {
      ...settings.output
    },
    translation: {
      ...settings.translation
    },
    advanced: {
      ...settings.advanced,
      experimentalFlags: [...settings.advanced.experimentalFlags]
    }
  }
}

function normalizeNonEmptyString(value: string, fallback: string): string {
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : fallback
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined
  }

  const normalized = value.trim()
  return normalized.length > 0 ? normalized : undefined
}

function normalizePort(value: number | undefined): number | undefined {
  if (value === undefined) {
    return undefined
  }

  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    return DEFAULT_LOCAL_SERVICE_PORT
  }

  return value
}

function normalizeExperimentalFlags(flags: string[]): string[] {
  const seen = new Set<string>()
  const normalized: string[] = []

  for (const flag of flags) {
    const trimmed = flag.trim()

    if (!trimmed || seen.has(trimmed)) {
      continue
    }

    seen.add(trimmed)
    normalized.push(trimmed)
  }

  return normalized
}
