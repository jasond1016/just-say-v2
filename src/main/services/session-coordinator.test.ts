import { describe, expect, it } from 'vitest'

import type {
  AudioChunk,
  AppRuntimeSnapshot,
  AppSettings,
  CaptureCommand,
  CaptureEvent,
  DiagnosticEvent,
  EngineCapabilities,
  OutputMethod,
  ResolvedRuntimeConfig,
  SavedTranscript
} from '../../shared/api-types'
import type { RecognitionEngine, RecognitionEvent } from '../../core/contracts/engine'
import { DEFAULT_SETTINGS } from '../../core/settings/settings-schema'
import { resolveRuntimeConfig } from '../../core/settings/settings-resolver'
import { CaptureWindowService } from '../platform/capture-window-service'
import { MeetingCoordinator } from './meeting-coordinator'
import { PttCoordinator } from './ptt-coordinator'
import { SessionCoordinator } from './session-coordinator'

describe('SessionCoordinator + PTTCoordinator', () => {
  it('prewarms the ptt engine', async () => {
    const harness = createHarness()

    await harness.sessionCoordinator.prewarm('ptt')

    expect(harness.engine.warmupCalls).toEqual([
      {
        mode: 'ptt',
        language: 'auto'
      }
    ])
  })

  it('broadcasts runtime snapshots to subscribers', async () => {
    const harness = createHarness()
    const seenStatuses: string[] = []
    const unsubscribe = harness.sessionCoordinator.onSnapshot((snapshot) => {
      seenStatuses.push(snapshot.ptt.status)
    })

    await harness.sessionCoordinator.startPtt()
    harness.captureTransport.emit({
      type: 'capture-started',
      requestId: 'ptt-1',
      sources: ['microphone']
    })

    expect(seenStatuses).toContain('arming')
    expect(seenStatuses).toContain('capturing')

    unsubscribe()
  })

  it('runs the happy path and publishes the final runtime snapshot', async () => {
    const harness = createHarness()
    const snapshots: AppRuntimeSnapshot[] = []
    const chunk = new Uint8Array([1, 2, 3, 4])

    snapshots.push(harness.sessionCoordinator.getRuntimeSnapshot())
    await harness.sessionCoordinator.startPtt()
    snapshots.push(harness.sessionCoordinator.getRuntimeSnapshot())

    harness.captureTransport.emit({
      type: 'capture-started',
      requestId: 'ptt-1',
      sources: ['microphone']
    })
    harness.captureTransport.emit({
      type: 'audio-chunk',
      requestId: 'ptt-1',
      chunk: {
        source: 'microphone',
        data: chunk,
        sampleRate: 16000,
        channels: 1,
        timestamp: 1111
      }
    })
    snapshots.push(harness.sessionCoordinator.getRuntimeSnapshot())

    const stopPromise = harness.sessionCoordinator.stopPtt()
    snapshots.push(harness.sessionCoordinator.getRuntimeSnapshot())

    harness.engine.emit({
      type: 'block-committed',
      payload: {
        block: {
          id: 'block-1',
          source: 'microphone',
          text: 'hello world',
          startedAt: 1000,
          endedAt: 1200
        }
      }
    })
    await stopPromise

    const finalSnapshot = harness.sessionCoordinator.getRuntimeSnapshot()
    snapshots.push(finalSnapshot)

    expect(snapshots[0]?.ptt.status).toBe('idle')
    expect(snapshots[1]?.ptt.status).toBe('capturing')
    expect(snapshots[2]?.ptt.status).toBe('capturing')
    expect(snapshots[3]?.ptt.status).toBe('recognizing')
    expect(snapshots[4]?.ptt.status).toBe('idle')
    expect(finalSnapshot.ptt.lastResult).toEqual({
      text: 'hello world',
      deliveredAt: 2000,
      deliveryMethod: 'simulate_input'
    })
    expect(harness.outputDispatcher.deliveries).toEqual([
      {
        text: 'hello world',
        method: 'simulate_input'
      }
    ])
    expect(harness.engine.pushAudioCalls).toEqual([
      {
        source: 'microphone',
        data: chunk,
        sampleRate: 16000,
        channels: 1,
        timestamp: 1111
      }
    ])
    expect(harness.captureTransport.commands).toEqual([
      {
        type: 'start',
        requestId: 'ptt-1',
        sources: ['microphone'],
        microphoneDeviceId: 'default',
        sampleRate: 16000,
        chunkMs: 100
      },
      {
        type: 'stop',
        requestId: 'ptt-1'
      }
    ])
    expect(harness.transcriptRepository.savedTranscripts).toMatchObject([
      {
        id: 'ptt-1',
        mode: 'ptt',
        plainText: 'hello world',
        metadata: {
          engineProfileId: 'local-fast',
          includeMicrophone: true,
          translationEnabled: false
        }
      }
    ])
  })

  it('uses translated text for delivery when translation is enabled', async () => {
    const harness = createHarness({
      settings: {
        ...DEFAULT_SETTINGS,
        translation: {
          ...DEFAULT_SETTINGS.translation,
          enabledForPtt: true,
          targetLanguage: 'ja'
        }
      },
      translationResults: {
        'block-1': 'こんにちは世界'
      }
    })

    await harness.sessionCoordinator.startPtt()
    harness.captureTransport.emit({
      type: 'capture-started',
      requestId: 'ptt-1',
      sources: ['microphone']
    })

    const stopPromise = harness.sessionCoordinator.stopPtt()
    harness.engine.emit({
      type: 'block-committed',
      payload: {
        block: {
          id: 'block-1',
          source: 'microphone',
          text: 'hello world',
          startedAt: 1000,
          endedAt: 1200
        }
      }
    })
    await stopPromise

    expect(harness.outputDispatcher.deliveries).toEqual([
      {
        text: 'こんにちは世界',
        method: 'simulate_input'
      }
    ])
    expect(harness.transcriptRepository.savedTranscripts[0]).toMatchObject({
      plainText: 'hello world',
      translatedPlainText: 'こんにちは世界',
      targetLanguage: 'ja'
    })
    expect(harness.engine.startSessionCalls).toEqual([
      {
        sessionId: 'ptt-1',
        mode: 'ptt',
        sources: ['microphone'],
        language: 'auto',
        translation: {
          enabled: false,
          targetLanguage: 'ja'
        }
      }
    ])
    expect(harness.translationPipeline?.calls).toEqual([
      {
        blockId: 'block-1',
        text: 'hello world',
        targetLanguage: 'ja'
      }
    ])
  })

  it('falls back to idle with an error snapshot when engine delivery fails', async () => {
    const harness = createHarness({
      outputFailure: new Error('Clipboard unavailable')
    })
    const notifications: Array<{ level: string; message: string }> = []
    const unsubscribe = harness.sessionCoordinator.onNotification((notification) => {
      notifications.push(notification)
    })

    await harness.sessionCoordinator.startPtt()
    harness.captureTransport.emit({
      type: 'capture-started',
      requestId: 'ptt-1',
      sources: ['microphone']
    })

    const stopPromise = harness.sessionCoordinator.stopPtt()
    harness.engine.emit({
      type: 'block-committed',
      payload: {
        block: {
          id: 'block-1',
          source: 'microphone',
          text: 'hello world',
          startedAt: 1000,
          endedAt: 1200
        }
      }
    })
    await stopPromise

    expect(harness.sessionCoordinator.getRuntimeSnapshot().ptt).toMatchObject({
      status: 'idle',
      error: {
        code: 'E_OUTPUT_DELIVERY',
        message: 'Clipboard unavailable',
        retryable: true,
        detail: {
          requestedMethod: 'simulate_input',
          transcriptText: 'hello world'
        }
      }
    })
    expect(notifications).toContainEqual({
      level: 'error',
      message: 'Transcript delivery failed. Use Copy Latest Text to recover the result.'
    })
    expect(harness.transcriptRepository.savedTranscripts).toHaveLength(0)

    await harness.sessionCoordinator.copyLatestPttText()

    expect(harness.sessionCoordinator.getRuntimeSnapshot().ptt).toMatchObject({
      status: 'idle',
      lastResult: {
        text: 'hello world',
        deliveryMethod: 'clipboard'
      }
    })
    expect(harness.outputDispatcher.deliveries).toEqual([
      {
        text: 'hello world',
        method: 'simulate_input'
      },
      {
        text: 'hello world',
        method: 'clipboard'
      }
    ])
    unsubscribe()
  })

  it('notifies when simulate-input delivery falls back to the clipboard', async () => {
    const harness = createHarness({
      outputFallbackReason: 'Simulated input is unavailable.'
    })
    const notifications: Array<{ level: string; message: string }> = []
    const unsubscribe = harness.sessionCoordinator.onNotification((notification) => {
      notifications.push(notification)
    })

    await harness.sessionCoordinator.startPtt()
    harness.captureTransport.emit({
      type: 'capture-started',
      requestId: 'ptt-1',
      sources: ['microphone']
    })

    const stopPromise = harness.sessionCoordinator.stopPtt()
    harness.engine.emit({
      type: 'block-committed',
      payload: {
        block: {
          id: 'block-1',
          source: 'microphone',
          text: 'hello world',
          startedAt: 1000,
          endedAt: 1200
        }
      }
    })
    await stopPromise

    expect(harness.sessionCoordinator.getRuntimeSnapshot().ptt.lastResult).toMatchObject({
      text: 'hello world',
      deliveryMethod: 'clipboard'
    })
    expect(notifications).toContainEqual({
      level: 'warning',
      message: 'Simulated input is unavailable. Copied the transcript to the clipboard instead.'
    })
    expect(harness.diagnostics.events).toContainEqual({
      type: 'output-delivered',
      timestamp: 2000,
      sessionId: 'ptt-1',
      requestedMethod: 'simulate_input',
      methodUsed: 'clipboard',
      fallback: true
    })
    unsubscribe()
  })

  it('runs the minimal meeting happy path and persists the live transcript', async () => {
    const harness = createHarness({
      settings: {
        ...DEFAULT_SETTINGS,
        input: {
          ...DEFAULT_SETTINGS.input,
          includeMicrophoneInMeeting: true
        },
        translation: {
          ...DEFAULT_SETTINGS.translation,
          enabledForMeeting: true,
          targetLanguage: 'en'
        }
      },
      translationResults: {
        'draft-1': '你好，世界'
      }
    })
    const chunk = new Uint8Array([9, 8, 7])
    const notifications: Array<{ level: string; message: string }> = []
    const unsubscribe = harness.sessionCoordinator.onNotification((notification) => {
      notifications.push(notification)
    })

    await harness.sessionCoordinator.startMeeting()
    harness.meetingCaptureTransport.emit({
      type: 'audio-chunk',
      requestId: 'meeting-1',
      chunk: {
        source: 'system',
        data: chunk,
        sampleRate: 16000,
        channels: 1,
        timestamp: 3333
      }
    })
    harness.meetingEngine.emit({
      type: 'session-ready'
    })
    harness.meetingEngine.emit({
      type: 'draft-updated',
      payload: {
        blockId: 'draft-1',
        source: 'system',
        stableText: 'hello',
        previewText: 'hello wor',
        startedAt: 1000,
        updatedAt: 1100
      }
    })
    harness.meetingEngine.emit({
      type: 'block-committed',
      payload: {
        block: {
          id: 'draft-1',
          source: 'system',
          text: 'hello world',
          startedAt: 1000,
          endedAt: 1200
        }
      }
    })
    await flushAsyncWork()

    const streamingSnapshot = harness.sessionCoordinator.getRuntimeSnapshot()
    expect(streamingSnapshot.liveSession).toMatchObject({
      sessionId: 'meeting-1',
      status: 'streaming',
      engineProfileId: 'local-fast',
      translationEnabled: true
    })
    expect(harness.meetingEngine.startSessionCalls).toEqual([
      {
        sessionId: 'meeting-1',
        mode: 'meeting',
        sources: ['system', 'microphone'],
        language: 'auto',
        translation: {
          enabled: false,
          targetLanguage: 'en'
        }
      }
    ])
    expect(streamingSnapshot.liveSession?.transcript).toMatchObject({
      activeDrafts: {},
      committedBlocks: [
        {
          id: 'draft-1',
          text: 'hello world',
          translatedText: '你好，世界'
        }
      ],
      revision: 3
    })
    expect(harness.meetingEngine.pushAudioCalls).toEqual([
      {
        source: 'system',
        data: chunk,
        sampleRate: 16000,
        channels: 1,
        timestamp: 3333
      }
    ])
    expect(harness.translationPipeline?.calls).toContainEqual({
      blockId: 'draft-1',
      text: 'hello world',
      targetLanguage: 'en'
    })

    const stopPromise = harness.sessionCoordinator.stopMeeting()
    harness.meetingEngine.emit({
      type: 'session-ended'
    })
    await stopPromise

    expect(harness.sessionCoordinator.getRuntimeSnapshot().liveSession).toBeNull()
    expect(harness.transcriptRepository.savedTranscripts).toMatchObject([
      {
        id: 'meeting-1',
        mode: 'meeting',
        plainText: 'hello world',
        translatedPlainText: '你好，世界',
        metadata: {
          engineProfileId: 'local-fast',
          includeMicrophone: true,
          translationEnabled: true
        }
      }
    ])
    expect(notifications).toContainEqual({
      level: 'info',
      message: 'Live session saved to history.'
    })
    unsubscribe()
  })

  it('persists meeting audio metadata when the recorder finalizes successfully', async () => {
    const meetingAudioRecorder = new FakeMeetingAudioRecorder({
      relativePath: 'meetings\\2026\\meeting-1.wav',
      status: 'complete'
    })
    const harness = createHarness({
      meetingAudioRecorder
    })
    const chunk = new Uint8Array([4, 3, 2, 1])

    await harness.sessionCoordinator.startMeeting()
    harness.meetingCaptureTransport.emit({
      type: 'audio-chunk',
      requestId: 'meeting-1',
      chunk: {
        source: 'system',
        data: chunk,
        sampleRate: 16000,
        channels: 1,
        timestamp: 3333
      }
    })
    harness.meetingEngine.emit({
      type: 'session-ready'
    })
    harness.meetingEngine.emit({
      type: 'block-committed',
      payload: {
        block: {
          id: 'block-1',
          source: 'system',
          text: 'hello world',
          startedAt: 1000,
          endedAt: 1200
        }
      }
    })

    const stopPromise = harness.sessionCoordinator.stopMeeting()
    harness.meetingEngine.emit({
      type: 'session-ended'
    })
    await stopPromise

    expect(meetingAudioRecorder.appendedChunks).toEqual([
      {
        source: 'system',
        data: chunk,
        sampleRate: 16000,
        channels: 1,
        timestamp: 3333
      }
    ])
    expect(meetingAudioRecorder.finalizeStatuses).toEqual(['complete'])
    expect(harness.transcriptRepository.savedTranscripts[0]?.metadata.audio).toMatchObject({
      relativePath: 'meetings\\2026\\meeting-1.wav',
      status: 'complete'
    })
  })

  it('saves a partial meeting record when streaming stops unexpectedly', async () => {
    const meetingAudioRecorder = new FakeMeetingAudioRecorder({
      relativePath: 'meetings\\2026\\meeting-1.wav',
      status: 'partial'
    })
    const harness = createHarness({
      meetingAudioRecorder
    })

    await harness.sessionCoordinator.startMeeting()
    harness.meetingCaptureTransport.emit({
      type: 'audio-chunk',
      requestId: 'meeting-1',
      chunk: {
        source: 'system',
        data: new Uint8Array([1, 2, 3, 4]),
        sampleRate: 16000,
        channels: 1,
        timestamp: 3333
      }
    })
    harness.meetingEngine.emit({
      type: 'session-ready'
    })
    harness.meetingEngine.emit({
      type: 'block-committed',
      payload: {
        block: {
          id: 'block-1',
          source: 'system',
          text: 'hello world',
          startedAt: 1000,
          endedAt: 1200
        }
      }
    })
    harness.meetingEngine.emit({
      type: 'error',
      payload: {
        code: 'E_ENGINE_TIMEOUT',
        message: 'Engine timed out',
        retryable: true
      }
    })
    await flushAsyncWork()

    expect(harness.sessionCoordinator.getRuntimeSnapshot().liveSession).toMatchObject({
      sessionId: 'meeting-1',
      status: 'stopped_unexpectedly'
    })
    expect(meetingAudioRecorder.finalizeStatuses).toEqual(['partial'])
    expect(harness.transcriptRepository.savedTranscripts[0]).toMatchObject({
      id: 'meeting-1',
      metadata: {
        audio: {
          relativePath: 'meetings\\2026\\meeting-1.wav',
          status: 'partial'
        }
      }
    })
  })

  it('applies meeting start overrides without mutating settings defaults', async () => {
    const harness = createHarness({
      settings: {
        ...DEFAULT_SETTINGS,
        input: {
          ...DEFAULT_SETTINGS.input,
          includeMicrophoneInMeeting: true
        },
        translation: {
          ...DEFAULT_SETTINGS.translation,
          enabledForMeeting: true,
          targetLanguage: 'en'
        }
      }
    })

    await harness.sessionCoordinator.startMeeting({
      includeMicrophone: false,
      translationEnabled: false,
      targetLanguage: 'ja'
    })

    expect(harness.meetingEngine.startSessionCalls).toEqual([
      {
        sessionId: 'meeting-1',
        mode: 'meeting',
        sources: ['system'],
        language: 'auto',
        translation: {
          enabled: false
        }
      }
    ])
    expect(harness.meetingCaptureTransport.commands).toEqual([
      {
        type: 'start',
        requestId: 'meeting-1',
        sources: ['system'],
        sampleRate: 16000,
        chunkMs: 100
      }
    ])
    expect(harness.settings.input.includeMicrophoneInMeeting).toBe(true)
    expect(harness.settings.translation.enabledForMeeting).toBe(true)
    expect(harness.settings.translation.targetLanguage).toBe('en')
  })

  it('falls back to the original PTT transcript when cloud translation fails', async () => {
    const harness = createHarness({
      settings: {
        ...DEFAULT_SETTINGS,
        translation: {
          ...DEFAULT_SETTINGS.translation,
          enabledForPtt: true,
          targetLanguage: 'ja'
        }
      },
      translationFailure: new Error('Translation upstream unavailable')
    })

    await harness.sessionCoordinator.startPtt()
    harness.captureTransport.emit({
      type: 'capture-started',
      requestId: 'ptt-1',
      sources: ['microphone']
    })

    const stopPromise = harness.sessionCoordinator.stopPtt()
    harness.engine.emit({
      type: 'block-committed',
      payload: {
        block: {
          id: 'block-1',
          source: 'microphone',
          text: 'hello world',
          startedAt: 1000,
          endedAt: 1200
        }
      }
    })
    await stopPromise

    expect(harness.outputDispatcher.deliveries).toEqual([
      {
        text: 'hello world',
        method: 'simulate_input'
      }
    ])
    expect(harness.sessionCoordinator.getRuntimeSnapshot().ptt.lastResult).toEqual({
      text: 'hello world',
      deliveredAt: 2000,
      deliveryMethod: 'simulate_input'
    })
    expect(harness.transcriptRepository.savedTranscripts[0]).toMatchObject({
      plainText: 'hello world'
    })
  })

  it('moves the live session into recovering and back to streaming after a recoverable warning', async () => {
    const primaryEngine = new FakeRecognitionEngine()
    const recoveryEngine = new FakeRecognitionEngine()
    const harness = createHarness({
      meetingEngines: [primaryEngine, recoveryEngine]
    })
    const notifications: Array<{ level: string; message: string }> = []
    const unsubscribe = harness.sessionCoordinator.onNotification((notification) => {
      notifications.push(notification)
    })

    await harness.sessionCoordinator.startMeeting()
    primaryEngine.emit({
      type: 'session-ready'
    })
    primaryEngine.emit({
      type: 'warning',
      payload: {
        code: 'W_ENGINE_STALL',
        message: 'Engine stalled briefly',
        recoverable: true
      }
    })
    await flushAsyncWork()

    expect(harness.sessionCoordinator.getRuntimeSnapshot().liveSession).toMatchObject({
      status: 'recovering'
    })

    expect(primaryEngine.abortSessionCalls).toBe(1)
    expect(recoveryEngine.startSessionCalls).toEqual([
      {
        sessionId: 'meeting-1',
        mode: 'meeting',
        sources: ['system'],
        language: 'auto',
        translation: {
          enabled: false
        }
      }
    ])
    expect(harness.meetingCaptureTransport.commands).toEqual([
      {
        type: 'start',
        requestId: 'meeting-1',
        sources: ['system'],
        sampleRate: 16000,
        chunkMs: 100
      }
    ])

    recoveryEngine.emit({
      type: 'session-ready'
    })
    await flushAsyncWork()

    expect(harness.sessionCoordinator.getRuntimeSnapshot().liveSession).toMatchObject({
      status: 'streaming'
    })
    expect(notifications).toEqual([
      {
        level: 'warning',
        message: 'Engine stalled briefly'
      },
      {
        level: 'warning',
        message: 'Attempting to recover the live session...'
      },
      {
        level: 'info',
        message: 'Live session recovered.'
      }
    ])
    unsubscribe()
  })

  it('falls back to stopped_unexpectedly when recovery cannot restart the live session', async () => {
    const primaryEngine = new FakeRecognitionEngine()
    const failedRecoveryEngine = new FakeRecognitionEngine({
      startSessionFailure: new Error('Recovery engine could not start')
    })
    const harness = createHarness({
      meetingEngines: [primaryEngine, failedRecoveryEngine]
    })

    await harness.sessionCoordinator.startMeeting()
    primaryEngine.emit({
      type: 'session-ready'
    })
    primaryEngine.emit({
      type: 'warning',
      payload: {
        code: 'W_ENGINE_STALL',
        message: 'Engine stalled briefly',
        recoverable: true
      }
    })
    await flushAsyncWork()
    await flushAsyncWork()

    expect(harness.sessionCoordinator.getRuntimeSnapshot().liveSession).toMatchObject({
      sessionId: 'meeting-1',
      status: 'stopped_unexpectedly',
      error: {
        code: 'E_ENGINE_PROTOCOL',
        message: 'Recovery engine could not start',
        retryable: true
      }
    })
  })

  it('retains a stopped_unexpectedly live session snapshot when meeting recognition fails', async () => {
    const harness = createHarness()

    await harness.sessionCoordinator.startMeeting()
    harness.meetingEngine.emit({
      type: 'session-ready'
    })
    harness.meetingEngine.emit({
      type: 'error',
      payload: {
        code: 'E_ENGINE_TIMEOUT',
        message: 'Engine timed out',
        retryable: true
      }
    })
    await flushAsyncWork()

    expect(harness.sessionCoordinator.getRuntimeSnapshot().liveSession).toMatchObject({
      sessionId: 'meeting-1',
      status: 'stopped_unexpectedly',
      error: {
        code: 'E_ENGINE_TIMEOUT',
        message: 'Engine timed out',
        retryable: true
      }
    })
  })

  it('surfaces storage write failures as product-level errors', async () => {
    const harness = createHarness({
      transcriptSaveFailure: new Error('Disk full')
    })

    await harness.sessionCoordinator.startPtt()
    harness.captureTransport.emit({
      type: 'capture-started',
      requestId: 'ptt-1',
      sources: ['microphone']
    })

    const stopPromise = harness.sessionCoordinator.stopPtt()
    harness.engine.emit({
      type: 'block-committed',
      payload: {
        block: {
          id: 'block-1',
          source: 'microphone',
          text: 'hello world',
          startedAt: 1000,
          endedAt: 1200
        }
      }
    })
    await stopPromise
    await flushAsyncWork()

    expect(harness.sessionCoordinator.getRuntimeSnapshot().ptt).toMatchObject({
      status: 'idle',
      error: {
        code: 'E_STORAGE_WRITE',
        message: 'Disk full',
        retryable: true
      }
    })
  })

  it('returns to idle and notifies when ptt ends without a committed transcript', async () => {
    const harness = createHarness()
    const notifications: Array<{ level: string; message: string }> = []
    const unsubscribe = harness.sessionCoordinator.onNotification((notification) => {
      notifications.push(notification)
    })

    await harness.sessionCoordinator.startPtt()
    harness.captureTransport.emit({
      type: 'capture-started',
      requestId: 'ptt-1',
      sources: ['microphone']
    })

    const stopPromise = harness.sessionCoordinator.stopPtt()
    harness.captureTransport.emit({
      type: 'capture-stopped',
      requestId: 'ptt-1'
    })
    harness.engine.emit({
      type: 'session-ended'
    })
    await stopPromise

    expect(harness.sessionCoordinator.getRuntimeSnapshot().ptt).toMatchObject({
      status: 'idle',
      error: {
        code: 'E_NO_SPEECH_DETECTED',
        message: 'PTT session ended without a transcript.',
        retryable: true
      }
    })
    expect(notifications).toContainEqual({
      level: 'warning',
      message: 'No speech was captured. Check the microphone level and try again.'
    })
    unsubscribe()
  })
})

type HarnessOptions = {
  settings?: AppSettings
  outputFailure?: Error
  outputFallbackReason?: string
  transcriptSaveFailure?: Error
  translationFailure?: Error
  translationResults?: Record<string, string>
  disableTranslationPipeline?: boolean
  meetingEngines?: FakeRecognitionEngine[]
  meetingAudioRecorder?: FakeMeetingAudioRecorder
  recoveryTimeoutMs?: number
}

function createHarness(options: HarnessOptions = {}) {
  const settings = options.settings ?? DEFAULT_SETTINGS
  const runtimeConfig = resolveRuntimeConfig({
    settings,
    mode: 'ptt',
    ...(settings.translation.enabledForPtt
      ? {
          credentials: {
            translationApiKey: 'translation-secret'
          }
        }
      : {})
  })
  const meetingRuntimeConfig = resolveRuntimeConfig({
    settings,
    mode: 'meeting',
    ...(settings.translation.enabledForMeeting
      ? {
          credentials: {
            translationApiKey: 'translation-secret'
          }
        }
      : {})
  })
  const engine = new FakeRecognitionEngine()
  const meetingEngines = options.meetingEngines ?? [new FakeRecognitionEngine()]
  const meetingEngine = meetingEngines[0]!
  let meetingEngineIndex = 0
  const translationPipeline = options.disableTranslationPipeline
    ? undefined
    : new FakeTranslationPipeline(options.translationResults, options.translationFailure)
  const captureTransport = createFakeCaptureTransport()
  const captureWindowService = new CaptureWindowService(captureTransport, {
    createRequestId: () => 'ptt-1',
    now: () => 1100
  })
  const meetingCaptureTransport = createFakeCaptureTransport()
  const meetingCaptureWindowService = new CaptureWindowService(meetingCaptureTransport, {
    createRequestId: () => 'meeting-1',
    now: () => 3100
  })
  const transcriptRepository = new FakeTranscriptRepository(options.transcriptSaveFailure)
  const outputDispatcher = new FakeOutputDispatcher(options.outputFailure, options.outputFallbackReason)
  const diagnostics = new FakeDiagnostics()

  const pttCoordinator = new PttCoordinator({
    settingsProvider: {
      getSettings: () => settings,
      resolveRuntimeConfig: () => runtimeConfig
    },
    engineFactory: () => engine,
    captureWindowService,
    transcriptRepository,
    outputDispatcher,
    ...(translationPipeline ? { translationPipeline } : {}),
    diagnostics,
    now: () => 2000,
    createSessionId: () => 'ptt-1'
  })
  const meetingCoordinator = new MeetingCoordinator({
    settingsProvider: {
      getSettings: () => settings,
      resolveRuntimeConfig: () => meetingRuntimeConfig
    },
    engineFactory: () => {
      const nextEngine = meetingEngines[Math.min(meetingEngineIndex, meetingEngines.length - 1)]!
      meetingEngineIndex += 1
      return nextEngine
    },
    captureWindowService: meetingCaptureWindowService,
    transcriptRepository,
    ...(translationPipeline ? { translationPipeline } : {}),
    ...(options.meetingAudioRecorder
      ? {
          audioRecorderFactory: () => options.meetingAudioRecorder!,
          deletePersistedAudio: async () => undefined
        }
      : {}),
    now: () => 4000,
    createSessionId: () => 'meeting-1',
    ...(options.recoveryTimeoutMs !== undefined ? { recoveryTimeoutMs: options.recoveryTimeoutMs } : {})
  })

  return {
    settings,
    runtimeConfig,
    meetingRuntimeConfig,
    engine,
    meetingEngine,
    meetingEngines,
    captureTransport,
    captureWindowService,
    meetingCaptureTransport,
    meetingCaptureWindowService,
    meetingAudioRecorder: options.meetingAudioRecorder,
    transcriptRepository,
    outputDispatcher,
    diagnostics,
    translationPipeline,
    pttCoordinator,
    meetingCoordinator,
    sessionCoordinator: new SessionCoordinator(pttCoordinator, meetingCoordinator)
  }
}

class FakeRecognitionEngine implements RecognitionEngine {
  readonly warmupCalls: Array<{ mode: 'ptt' | 'meeting'; language: string }> = []
  readonly startSessionCalls: Array<Parameters<RecognitionEngine['startSession']>[0]> = []
  readonly pushAudioCalls: Array<Parameters<RecognitionEngine['pushAudio']>[0]> = []
  abortSessionCalls = 0
  private readonly listeners = new Set<(event: RecognitionEvent) => void>()

  constructor(
    private readonly options: {
      startSessionFailure?: Error
    } = {}
  ) {}

  async getCapabilities(): Promise<EngineCapabilities> {
    return {
      streaming: true,
      translation: false,
      wordTiming: false,
      speakerSeparation: false,
      requiresNetwork: false,
      requiresLocalService: false
    }
  }

  async warmup(input: Parameters<RecognitionEngine['warmup']>[0]): Promise<void> {
    this.warmupCalls.push(input)
  }

  async startSession(input: Parameters<RecognitionEngine['startSession']>[0]): Promise<void> {
    if (this.options.startSessionFailure) {
      throw this.options.startSessionFailure
    }
    this.startSessionCalls.push(input)
  }

  pushAudio(chunk: Parameters<RecognitionEngine['pushAudio']>[0]): void {
    this.pushAudioCalls.push(chunk)
  }

  async stopSession(): Promise<void> {}

  async abortSession(): Promise<void> {
    this.abortSessionCalls += 1
  }

  onEvent(listener: (event: RecognitionEvent) => void): () => void {
    this.listeners.add(listener)

    return () => {
      this.listeners.delete(listener)
    }
  }

  emit(event: RecognitionEvent): void {
    for (const listener of this.listeners) {
      listener(event)
    }
  }
}

class FakeTranscriptRepository {
  readonly savedTranscripts: SavedTranscript[] = []

  constructor(private readonly failure?: Error) {}

  async save(transcript: SavedTranscript): Promise<void> {
    if (this.failure) {
      throw this.failure
    }

    this.savedTranscripts.push(transcript)
  }
}

class FakeOutputDispatcher {
  readonly deliveries: Array<{ text: string; method: OutputMethod }> = []
  private failedOnce = false

  constructor(
    private readonly failure: Error | undefined,
    private readonly fallbackReason?: string
  ) {}

  async deliver(input: {
    text: string
    method: OutputMethod
  }): Promise<{ requestedMethod: OutputMethod; methodUsed: OutputMethod; fallbackReason?: string }> {
    this.deliveries.push(input)

    if (this.failure && !this.failedOnce) {
      this.failedOnce = true
      const error = new Error(this.failure.message)
      ;(error as Error & {
        payload?: {
          code: 'E_OUTPUT_DELIVERY'
          message: string
          retryable: true
          detail: {
            requestedMethod: OutputMethod
            transcriptText: string
          }
        }
      }).payload = {
        code: 'E_OUTPUT_DELIVERY',
        message: this.failure.message,
        retryable: true,
        detail: {
          requestedMethod: input.method,
          transcriptText: input.text
        }
      }
      throw error
    }

    return this.fallbackReason && input.method === 'simulate_input'
      ? {
          requestedMethod: input.method,
          methodUsed: 'clipboard',
          fallbackReason: this.fallbackReason
        }
      : {
          requestedMethod: input.method,
          methodUsed: input.method
        }
  }
}

class FakeDiagnostics {
  readonly events: DiagnosticEvent[] = []

  record(event: DiagnosticEvent): void {
    this.events.push(event)
  }
}

class FakeTranslationPipeline {
  readonly calls: Array<{ blockId: string; text: string; targetLanguage: string }> = []

  constructor(
    private readonly results: Record<string, string> = {},
    private readonly failure?: Error
  ) {}

  async translateBlock(input: {
    runtimeConfig: ResolvedRuntimeConfig
    block: SavedTranscript['blocks'][number]
  }): Promise<{ blockId: string; translatedText: string }> {
    const targetLanguage = input.runtimeConfig.translationConfig?.targetLanguage ?? ''
    this.calls.push({
      blockId: input.block.id,
      text: input.block.text,
      targetLanguage
    })
    await Promise.resolve()

    if (this.failure) {
      throw this.failure
    }

    return {
      blockId: input.block.id,
      translatedText: this.results[input.block.id] ?? `translated:${input.block.text}`
    }
  }
}

class FakeMeetingAudioRecorder {
  readonly appendedChunks: AudioChunk[] = []
  readonly finalizeStatuses: Array<'complete' | 'partial'> = []
  discardCalls = 0

  constructor(
    private readonly output: {
      relativePath: string
      status: 'complete' | 'partial'
    } | null,
    private readonly finalizeFailure?: Error
  ) {}

  appendChunk(chunk: AudioChunk): void {
    this.appendedChunks.push(chunk)
  }

  async finalize(status: 'complete' | 'partial') {
    this.finalizeStatuses.push(status)

    if (this.finalizeFailure) {
      throw this.finalizeFailure
    }

    if (!this.output) {
      return null
    }

    return {
      relativePath: this.output.relativePath,
      format: 'wav' as const,
      sampleRate: 16000,
      channels: 1 as const,
      status,
      durationMs: 1200,
      byteLength: 38444
    }
  }

  async discard(): Promise<void> {
    this.discardCalls += 1
  }
}

function createFakeCaptureTransport() {
  const listeners = new Set<(event: CaptureEvent) => void>()

  return {
    commands: [] as CaptureCommand[],
    async ensureReady() {},
    async sendCommand(command: CaptureCommand) {
      this.commands.push(command)
    },
    onEvent(listener: (event: CaptureEvent) => void) {
      listeners.add(listener)

      return () => {
        listeners.delete(listener)
      }
    },
    emit(event: CaptureEvent) {
      for (const listener of listeners) {
        listener(event)
      }
    }
  }
}

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}
