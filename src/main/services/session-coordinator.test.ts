import { describe, expect, it } from 'vitest'

import type {
  AppRuntimeSnapshot,
  AppSettings,
  CaptureCommand,
  CaptureEvent,
  EngineCapabilities,
  OutputMethod,
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
    harness.engine.emit({
      type: 'translation-updated',
      payload: {
        blockId: 'block-1',
        translatedText: 'こんにちは世界'
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
  })

  it('falls back to idle with an error snapshot when engine delivery fails', async () => {
    const harness = createHarness({
      outputFailure: new Error('Clipboard unavailable')
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
        code: 'E_ENGINE_PROTOCOL',
        message: 'Clipboard unavailable',
        retryable: true
      }
    })
    expect(harness.transcriptRepository.savedTranscripts).toHaveLength(0)
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
      }
    })
    const chunk = new Uint8Array([9, 8, 7])

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
    harness.meetingEngine.emit({
      type: 'translation-updated',
      payload: {
        blockId: 'draft-1',
        translatedText: '你好，世界'
      }
    })

    const streamingSnapshot = harness.sessionCoordinator.getRuntimeSnapshot()
    expect(streamingSnapshot.liveSession).toMatchObject({
      sessionId: 'meeting-1',
      status: 'streaming',
      engineProfileId: 'local-fast',
      translationEnabled: true
    })
    expect(streamingSnapshot.liveSession?.transcript).toMatchObject({
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
})

type HarnessOptions = {
  settings?: AppSettings
  outputFailure?: Error
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
  const meetingEngine = new FakeRecognitionEngine()
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
  const transcriptRepository = new FakeTranscriptRepository()
  const outputDispatcher = new FakeOutputDispatcher(options.outputFailure)

  const pttCoordinator = new PttCoordinator({
    settingsProvider: {
      getSettings: () => settings,
      resolveRuntimeConfig: () => runtimeConfig
    },
    engineFactory: () => engine,
    captureWindowService,
    transcriptRepository,
    outputDispatcher,
    now: () => 2000,
    createSessionId: () => 'ptt-1'
  })
  const meetingCoordinator = new MeetingCoordinator({
    settingsProvider: {
      getSettings: () => settings,
      resolveRuntimeConfig: () => meetingRuntimeConfig
    },
    engineFactory: () => meetingEngine,
    captureWindowService: meetingCaptureWindowService,
    transcriptRepository,
    now: () => 4000,
    createSessionId: () => 'meeting-1'
  })

  return {
    settings,
    runtimeConfig,
    meetingRuntimeConfig,
    engine,
    meetingEngine,
    captureTransport,
    captureWindowService,
    meetingCaptureTransport,
    meetingCaptureWindowService,
    transcriptRepository,
    outputDispatcher,
    pttCoordinator,
    meetingCoordinator,
    sessionCoordinator: new SessionCoordinator(pttCoordinator, meetingCoordinator)
  }
}

class FakeRecognitionEngine implements RecognitionEngine {
  readonly warmupCalls: Array<{ mode: 'ptt' | 'meeting'; language: string }> = []
  readonly startSessionCalls: Array<Parameters<RecognitionEngine['startSession']>[0]> = []
  readonly pushAudioCalls: Array<Parameters<RecognitionEngine['pushAudio']>[0]> = []
  private readonly listeners = new Set<(event: RecognitionEvent) => void>()

  async getCapabilities(): Promise<EngineCapabilities> {
    return {
      streaming: true,
      translation: true,
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
    this.startSessionCalls.push(input)
  }

  pushAudio(chunk: Parameters<RecognitionEngine['pushAudio']>[0]): void {
    this.pushAudioCalls.push(chunk)
  }

  async stopSession(): Promise<void> {}

  async abortSession(): Promise<void> {}

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

  async save(transcript: SavedTranscript): Promise<void> {
    this.savedTranscripts.push(transcript)
  }
}

class FakeOutputDispatcher {
  readonly deliveries: Array<{ text: string; method: OutputMethod }> = []

  constructor(private readonly failure: Error | undefined) {}

  async deliver(input: { text: string; method: OutputMethod }): Promise<void> {
    if (this.failure) {
      throw this.failure
    }

    this.deliveries.push(input)
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
