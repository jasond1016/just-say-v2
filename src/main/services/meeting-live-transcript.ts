import type {
  DiagnosticEvent,
  ResolvedRuntimeConfig,
  RuntimeNotification,
  TranscriptState
} from '../../shared/api-types'
import type { RecognitionEvent } from '../../core/contracts/engine'
import { cloneTranscriptState } from '../../core/transcript/clone-transcript-state'
import { transcriptReducer, INITIAL_TRANSCRIPT_STATE } from '../../core/transcript/transcript-reducer'
import { selectPlainText, selectTranslatedPlainText } from '../../core/transcript/transcript-selectors'
import type { TranscriptEvent } from '../../core/transcript/transcript-types'
import {
  CROSS_SOURCE_NEAR_DUP_WINDOW_MS,
  isCrossSourceNearDuplicate
} from './cross-source-near-duplicate'
import {
  isMicrophoneShortJunkCommit,
  isMicrophoneShortJunkText
} from './mic-short-junk'
import type { TranslationPipeline } from './translation-pipeline'

export type MeetingLiveTranscriptDependencies = {
  translationPipeline?: Pick<TranslationPipeline, 'translateBlock'>
  diagnostics?: {
    record(event: DiagnosticEvent): void
  }
  now?: () => number
  notify?: (notification: RuntimeNotification) => void
  onChanged?: () => void
}

type ActiveLiveTranscript = {
  sessionId: string
  runtimeConfig: ResolvedRuntimeConfig
  transcript: TranscriptState
  pendingTranslations: Set<Promise<void>>
}

/**
 * Deep module for meeting Draft Stability / live transcript data-plane.
 * MeetingCoordinator keeps SessionDispatchLoop, recovery, and Recognition Session bind.
 */
export class MeetingLiveTranscript {
  private readonly now: () => number
  private active: ActiveLiveTranscript | null = null

  constructor(private readonly dependencies: MeetingLiveTranscriptDependencies = {}) {
    this.now = dependencies.now ?? Date.now
  }

  reset(sessionId: string, runtimeConfig: ResolvedRuntimeConfig): void {
    this.active = {
      sessionId,
      runtimeConfig,
      transcript: INITIAL_TRANSCRIPT_STATE,
      pendingTranslations: new Set()
    }
  }

  clear(): void {
    this.active = null
  }

  /**
   * Handles draft/block/translation recognition events.
   * @returns true if the event was consumed by the live-transcript data-plane.
   */
  handleRecognitionEvent(event: RecognitionEvent): boolean {
    const session = this.active

    if (!session) {
      return false
    }

    switch (event.type) {
      case 'draft-updated': {
        const draftText = `${event.payload.stableText}${event.payload.previewText}`
        if (event.payload.source === 'microphone') {
          if (this.shouldSuppressMicrophoneEcho(session, draftText, event.payload.updatedAt)) {
            this.clearMicrophoneDraft(session)
            this.emitChanged()
            return true
          }

          if (isMicrophoneShortJunkText(draftText)) {
            this.clearMicrophoneDraft(session)
            this.emitChanged()
            return true
          }
        }

        this.applyTranscriptEvent(session, {
          type: 'draft-updated',
          payload: event.payload
        })
        this.dependencies.diagnostics?.record({
          type: 'draft-received',
          timestamp: this.now(),
          sessionId: session.sessionId,
          source: event.payload.source,
          chars: draftText.trim().length
        })
        this.emitChanged()
        return true
      }
      case 'block-committed': {
        if (event.payload.block.source === 'microphone') {
          if (
            this.shouldSuppressMicrophoneEcho(
              session,
              event.payload.block.text,
              event.payload.block.endedAt
            )
          ) {
            this.clearMicrophoneDraft(session)
            this.emitChanged()
            return true
          }

          if (
            isMicrophoneShortJunkCommit({
              text: event.payload.block.text,
              startedAt: event.payload.block.startedAt,
              endedAt: event.payload.block.endedAt
            })
          ) {
            this.clearMicrophoneDraft(session)
            this.emitChanged()
            return true
          }
        }

        this.applyTranscriptEvent(session, {
          type: 'block-committed',
          payload: event.payload
        })
        this.dependencies.diagnostics?.record({
          type: 'block-committed',
          timestamp: this.now(),
          sessionId: session.sessionId,
          blockId: event.payload.block.id,
          chars: event.payload.block.text.length
        })
        this.emitChanged()

        if (
          session.runtimeConfig.translationConfig &&
          !session.runtimeConfig.engineProfile.capabilities.translation
        ) {
          this.startTranslationTask(session, event.payload.block)
        }

        return true
      }
      case 'translation-updated':
        this.applyTranscriptEvent(session, {
          type: 'translation-updated',
          payload: event.payload
        })
        this.emitChanged()
        return true
      default:
        return false
    }
  }

  getTranscript(): TranscriptState {
    if (!this.active) {
      return cloneTranscriptState(INITIAL_TRANSCRIPT_STATE)
    }

    return cloneTranscriptState(this.active.transcript)
  }

  getSnapshotFields(): { transcript: TranscriptState; translationEnabled: boolean } {
    if (!this.active) {
      return {
        transcript: cloneTranscriptState(INITIAL_TRANSCRIPT_STATE),
        translationEnabled: false
      }
    }

    return {
      transcript: cloneTranscriptState(this.active.transcript),
      translationEnabled: Boolean(this.active.runtimeConfig.translationConfig)
    }
  }

  async awaitPendingTranslations(): Promise<void> {
    if (!this.active) {
      return
    }

    await Promise.allSettled([...this.active.pendingTranslations])
  }

  buildSavedTranscriptInput(): {
    plainText: string
    translatedPlainText?: string
    blocks: TranscriptState['committedBlocks']
  } {
    if (!this.active) {
      return {
        plainText: '',
        blocks: []
      }
    }

    const { transcript } = this.active
    const translatedPlainText = selectTranslatedPlainText(transcript)

    return {
      plainText: selectPlainText(transcript),
      ...(translatedPlainText ? { translatedPlainText } : {}),
      blocks: transcript.committedBlocks
    }
  }

  private applyTranscriptEvent(session: ActiveLiveTranscript, event: TranscriptEvent): void {
    session.transcript = transcriptReducer(session.transcript, event)
  }

  private shouldSuppressMicrophoneEcho(
    session: ActiveLiveTranscript,
    microphoneText: string,
    at: number
  ): boolean {
    const systemDraft = session.transcript.activeDrafts.system
    if (systemDraft) {
      const systemText = `${systemDraft.stableText}${systemDraft.previewText}`
      const systemAt = systemDraft.updatedAt
      if (
        Math.abs(at - systemAt) <= CROSS_SOURCE_NEAR_DUP_WINDOW_MS &&
        isCrossSourceNearDuplicate(microphoneText, systemText)
      ) {
        return true
      }
    }

    for (const block of session.transcript.committedBlocks) {
      if (block.source !== 'system') {
        continue
      }

      if (
        Math.abs(at - block.endedAt) <= CROSS_SOURCE_NEAR_DUP_WINDOW_MS &&
        isCrossSourceNearDuplicate(microphoneText, block.text)
      ) {
        return true
      }
    }

    return false
  }

  private clearMicrophoneDraft(session: ActiveLiveTranscript): void {
    if (!session.transcript.activeDrafts.microphone) {
      return
    }

    const { microphone: _removed, ...rest } = session.transcript.activeDrafts
    session.transcript = {
      ...session.transcript,
      activeDrafts: rest,
      revision: session.transcript.revision + 1
    }
  }

  private emitChanged(): void {
    this.dependencies.onChanged?.()
  }

  private startTranslationTask(
    session: ActiveLiveTranscript,
    block: TranscriptState['committedBlocks'][number]
  ): void {
    const task = this.translateCommittedBlock(session, block)
    session.pendingTranslations.add(task)
    void task.finally(() => {
      session.pendingTranslations.delete(task)
    })
  }

  private async translateCommittedBlock(
    session: ActiveLiveTranscript,
    block: TranscriptState['committedBlocks'][number]
  ): Promise<void> {
    if (!session.runtimeConfig.translationConfig || !this.dependencies.translationPipeline) {
      this.dependencies.notify?.({
        level: 'warning',
        message: 'Translation is enabled but no translation pipeline is configured. Continuing without translated text.'
      })
      return
    }

    try {
      const translation = await this.dependencies.translationPipeline.translateBlock({
        runtimeConfig: session.runtimeConfig,
        block
      })

      if (this.active?.sessionId !== session.sessionId) {
        return
      }

      this.applyTranscriptEvent(session, {
        type: 'translation-updated',
        payload: translation
      })
      this.emitChanged()
    } catch (errorLike) {
      if (this.active?.sessionId !== session.sessionId) {
        return
      }

      this.dependencies.diagnostics?.record({
        type: 'translation-failed',
        timestamp: this.now(),
        sessionId: session.sessionId,
        reason: errorLike instanceof Error ? errorLike.message : 'Unknown translation failure'
      })
      this.dependencies.notify?.({
        level: 'warning',
        message: 'Translation failed for one transcript block. Continuing with the original transcript.'
      })
    }
  }
}
