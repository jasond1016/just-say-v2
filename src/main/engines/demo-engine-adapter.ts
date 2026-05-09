import type { RecognitionEngine, RecognitionEvent, StartSessionInput } from '../../core/contracts/engine'
import type { ResolvedRuntimeConfig } from '../../shared/api-types'

export function createDemoRecognitionEngine(config: ResolvedRuntimeConfig): RecognitionEngine {
  const listeners = new Set<(event: RecognitionEvent) => void>()
  let activeSession: StartSessionInput | null = null
  let stopped = false

  return {
    async getCapabilities() {
      return {
        ...config.engineProfile.capabilities
      }
    },
    async warmup() {},
    async startSession(input) {
      activeSession = input
      stopped = false
      queueMicrotask(() => {
        emitRecognitionEvent(listeners, { type: 'session-ready' })
      })
    },
    pushAudio() {},
    async stopSession() {
      if (!activeSession || stopped) {
        return
      }

      stopped = true

      const script = createDemoScript(activeSession, config)

      for (const event of script) {
        queueMicrotask(() => {
          emitRecognitionEvent(listeners, event)
        })
      }
    },
    async abortSession() {},
    onEvent(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }
  }
}

function emitRecognitionEvent(
  listeners: Set<(event: RecognitionEvent) => void>,
  event: RecognitionEvent
): void {
  for (const listener of listeners) {
    listener(event)
  }
}

function createDemoScript(
  input: StartSessionInput,
  config: ResolvedRuntimeConfig
): RecognitionEvent[] {
  const now = Date.now()
  const translationEnabled = input.translation.enabled

  if (input.mode === 'ptt') {
    return [
      {
        type: 'block-committed',
        payload: {
          block: {
            id: `${input.sessionId}-block-1`,
            source: 'microphone',
            text: 'JustSay V2 demo PTT result.',
            startedAt: now - 1200,
            endedAt: now
          }
        }
      },
      ...(translationEnabled
        ? [
            {
              type: 'translation-updated' as const,
              payload: {
                blockId: `${input.sessionId}-block-1`,
                translatedText: getDemoTranslation(
                  config,
                  input.translation.targetLanguage,
                  '即时口语输入演示结果。'
                )
              }
            }
          ]
        : [])
    ]
  }

  return [
    {
      type: 'draft-updated',
      payload: {
        blockId: `${input.sessionId}-draft-1`,
        source: 'system',
        stableText: 'Weekly sync',
        previewText: 'Weekly sync is ready to start',
        ...(translationEnabled
          ? {
              translatedPreviewText: getDemoTranslation(
                config,
                input.translation.targetLanguage,
                '每周同步已经可以开始'
              )
            }
          : {}),
        startedAt: now - 4000,
        updatedAt: now - 1500
      }
    },
    {
      type: 'block-committed',
      payload: {
        block: {
          id: `${input.sessionId}-draft-1`,
          source: 'system',
          text: 'Weekly sync is ready to start.',
          startedAt: now - 4000,
          endedAt: now - 1000
        }
      }
    },
    ...(translationEnabled
      ? [
          {
            type: 'translation-updated' as const,
            payload: {
              blockId: `${input.sessionId}-draft-1`,
              translatedText: getDemoTranslation(
                config,
                input.translation.targetLanguage,
                '每周同步已经可以开始。'
              )
            }
          }
        ]
      : []),
    {
      type: 'session-ended'
    }
  ]
}

function getDemoTranslation(
  config: ResolvedRuntimeConfig,
  targetLanguage: string | undefined,
  fallback: string
): string {
  const resolvedTargetLanguage =
    typeof targetLanguage === 'string'
      ? targetLanguage
      : typeof config.translationConfig?.targetLanguage === 'string'
        ? config.translationConfig.targetLanguage
        : ''

  if (resolvedTargetLanguage.toLowerCase().startsWith('ja')) {
    return '毎週の同期を開始できます。'
  }

  if (resolvedTargetLanguage.toLowerCase().startsWith('en')) {
    return 'Weekly sync is ready to start.'
  }

  return fallback
}
