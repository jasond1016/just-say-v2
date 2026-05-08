import type { AppRuntimeSnapshot, StartMeetingCommand } from '../../shared/api-types'
import type { SessionMode } from '../../shared/primitive-types'
import { INITIAL_RUNTIME_SNAPSHOT } from '../../renderer/features/runtime/runtime-store'
import type { MeetingCoordinator } from './meeting-coordinator'
import type { PttCoordinator } from './ptt-coordinator'

export class SessionCoordinator {
  private snapshot: AppRuntimeSnapshot = INITIAL_RUNTIME_SNAPSHOT
  private readonly unsubscribePtt: () => void
  private readonly unsubscribeMeeting: () => void

  constructor(
    private readonly pttCoordinator: PttCoordinator,
    private readonly meetingCoordinator: MeetingCoordinator
  ) {
    this.unsubscribePtt = this.pttCoordinator.onSnapshot((pttSnapshot) => {
      this.snapshot = {
        ...this.snapshot,
        ptt: pttSnapshot
      }
    })
    this.unsubscribeMeeting = this.meetingCoordinator.onSnapshot((meetingSnapshot) => {
      this.snapshot = {
        ...this.snapshot,
        liveSession: meetingSnapshot
      }
    })
  }

  dispose(): void {
    this.unsubscribePtt()
    this.unsubscribeMeeting()
  }

  getRuntimeSnapshot(): AppRuntimeSnapshot {
    return {
      ...this.snapshot,
      ptt: {
        ...this.snapshot.ptt,
        ...(this.snapshot.ptt.lastResult ? { lastResult: { ...this.snapshot.ptt.lastResult } } : {})
      },
      liveSession: this.snapshot.liveSession
        ? {
            ...this.snapshot.liveSession,
            transcript: {
              committedBlocks: this.snapshot.liveSession.transcript.committedBlocks.map((block) => ({
                ...block,
                ...(block.words ? { words: [...block.words] } : {})
              })),
              activeDrafts: Object.fromEntries(
                Object.entries(this.snapshot.liveSession.transcript.activeDrafts).map(
                  ([source, draft]) => [
                    source,
                    draft
                      ? {
                          ...draft,
                          ...(draft.words ? { words: [...draft.words] } : {})
                        }
                      : draft
                  ]
                )
              ),
              revision: this.snapshot.liveSession.transcript.revision
            }
          }
        : null,
      services: {
        ...this.snapshot.services
      }
    }
  }

  async prewarm(mode: SessionMode): Promise<void> {
    if (mode === 'ptt') {
      await this.pttCoordinator.prewarm()
      return
    }

    if (mode === 'meeting') {
      return
    }

    throw new Error(`Unsupported prewarm mode: ${String(mode)}`)
  }

  async startPtt(): Promise<void> {
    await this.pttCoordinator.start()
  }

  async stopPtt(): Promise<void> {
    await this.pttCoordinator.stop()
  }

  async startMeeting(input?: StartMeetingCommand): Promise<void> {
    await this.meetingCoordinator.start(input)
  }

  async stopMeeting(): Promise<void> {
    await this.meetingCoordinator.stop()
  }
}
