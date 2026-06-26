import type {
  ResolvedRuntimeConfig,
  SavedTranscript,
  TranscriptAudioMetadata,
  TranscriptBlock
} from '../../shared/api-types'

type SessionMetadataInput = {
  runtimeConfig: ResolvedRuntimeConfig
  includeMicrophone: boolean
  translationEnabled: boolean
  audio?: TranscriptAudioMetadata | null
}

export function buildSessionTranscriptMetadata(input: SessionMetadataInput): SavedTranscript['metadata'] {
  const { runtimeConfig } = input

  return {
    engineProfileId: runtimeConfig.engineProfile.id,
    runtimeFamilyId: runtimeConfig.engineProfile.runtimeFamilyId,
    modelIdentifier: runtimeConfig.engineProfile.modelIdentifier,
    deploymentMode: runtimeConfig.engineConfig.localService?.mode ?? 'managed-local',
    includeMicrophone: input.includeMicrophone,
    translationEnabled: input.translationEnabled,
    ...(input.audio ? { audio: { ...input.audio } } : {})
  }
}

export type BuildPttSavedTranscriptInput = {
  sessionId: string
  startedAt: number
  endedAt: number
  runtimeConfig: ResolvedRuntimeConfig
  finalText: string
  translatedText?: string | null
}

export function buildPttSavedTranscript(input: BuildPttSavedTranscriptInput): SavedTranscript {
  const displayText = input.translatedText ?? input.finalText

  return {
    id: input.sessionId,
    mode: 'ptt',
    title: displayText.slice(0, 48) || 'PTT Transcript',
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    language: String(input.runtimeConfig.engineConfig.language),
    plainText: input.finalText,
    blocks: [
      {
        id: `${input.sessionId}-block-1`,
        source: 'microphone',
        text: input.finalText,
        ...(input.translatedText ? { translatedText: input.translatedText } : {}),
        startedAt: input.startedAt,
        endedAt: input.endedAt
      }
    ],
    metadata: buildSessionTranscriptMetadata({
      runtimeConfig: input.runtimeConfig,
      includeMicrophone: true,
      translationEnabled: Boolean(input.runtimeConfig.translationConfig)
    }),
    ...buildTranslationFields({
      runtimeConfig: input.runtimeConfig,
      translatedPlainText: input.translatedText ?? undefined
    })
  }
}

export type BuildMeetingSavedTranscriptInput = {
  sessionId: string
  startedAt: number
  endedAt: number
  runtimeConfig: ResolvedRuntimeConfig
  includeMicrophone: boolean
  plainText: string
  translatedPlainText?: string
  blocks: TranscriptBlock[]
  audioMetadata?: TranscriptAudioMetadata | null
}

export function buildMeetingSavedTranscript(input: BuildMeetingSavedTranscriptInput): SavedTranscript {
  return {
    id: input.sessionId,
    mode: 'meeting',
    title: `Live Session ${new Date(input.startedAt).toISOString()}`,
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    language: String(input.runtimeConfig.engineConfig.language),
    plainText: input.plainText,
    blocks: input.blocks.map((block) => ({ ...block })),
    metadata: buildSessionTranscriptMetadata({
      runtimeConfig: input.runtimeConfig,
      includeMicrophone: input.includeMicrophone,
      translationEnabled: Boolean(input.runtimeConfig.translationConfig),
      audio: input.audioMetadata
    }),
    ...buildTranslationFields({
      runtimeConfig: input.runtimeConfig,
      translatedPlainText: input.translatedPlainText
    })
  }
}

function buildTranslationFields(input: {
  runtimeConfig: ResolvedRuntimeConfig
  translatedPlainText?: string
}): Pick<SavedTranscript, 'targetLanguage' | 'translatedPlainText'> {
  if (!input.runtimeConfig.translationConfig) {
    return {}
  }

  return {
    targetLanguage: String(input.runtimeConfig.translationConfig.targetLanguage),
    ...(input.translatedPlainText ? { translatedPlainText: input.translatedPlainText } : {})
  }
}
