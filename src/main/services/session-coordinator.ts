import type {
  AppRuntimeSnapshot,
  LocalServiceStatus,
  RuntimeNotification,
  StartMeetingCommand
} from '../../shared/api-types'
import type { SessionMode } from '../../shared/primitive-types'
import { freezeRuntimeSnapshot } from '../../core/runtime/freeze-runtime-snapshot'
import { INITIAL_RUNTIME_SNAPSHOT } from '../../shared/runtime-snapshot'
import type { MeetingCoordinator } from './meeting-coordinator'
import type { PttCoordinator } from './ptt-coordinator'
import { assertRecognitionLeaseAvailable } from './session-lease'

export class SessionCoordinator {
  private snapshot: AppRuntimeSnapshot = INITIAL_RUNTIME_SNAPSHOT
  private readonly unsubscribePtt: () => void
  private readonly unsubscribeMeeting: () => void
  private readonly listeners = new Set<(snapshot: AppRuntimeSnapshot) => void>()
  private readonly notificationListeners = new Set<(notification: RuntimeNotification) => void>()

  constructor(
    private readonly pttCoordinator: PttCoordinator,
    private readonly meetingCoordinator: MeetingCoordinator
  ) {
    this.unsubscribePtt = this.pttCoordinator.onSnapshot((pttSnapshot) => {
      this.snapshot = {
        ...this.snapshot,
        ptt: pttSnapshot
      }
      this.emitSnapshot()
    })
    this.unsubscribeMeeting = this.meetingCoordinator.onSnapshot((meetingSnapshot) => {
      this.snapshot = {
        ...this.snapshot,
        liveSession: meetingSnapshot
      }
      this.emitSnapshot()
    })
    this.pttCoordinator.onNotification?.((notification) => {
      this.emitNotification(notification)
    })
    this.meetingCoordinator.onNotification?.((notification) => {
      this.emitNotification(notification)
    })
  }

  dispose(): void {
    this.unsubscribePtt()
    this.unsubscribeMeeting()
  }

  getRuntimeSnapshot(): AppRuntimeSnapshot {
    return freezeRuntimeSnapshot(this.snapshot)
  }

  onSnapshot(listener: (snapshot: AppRuntimeSnapshot) => void): () => void {
    this.listeners.add(listener)

    return () => {
      this.listeners.delete(listener)
    }
  }

  onNotification(listener: (notification: RuntimeNotification) => void): () => void {
    this.notificationListeners.add(listener)

    return () => {
      this.notificationListeners.delete(listener)
    }
  }

  async prewarm(mode: SessionMode): Promise<void> {
    if (mode === 'ptt') {
      await this.pttCoordinator.prewarm()
      return
    }

    if (mode === 'meeting') {
      await this.meetingCoordinator.prewarm()
      return
    }

    throw new Error(`Unsupported prewarm mode: ${String(mode)}`)
  }

  async startPtt(): Promise<void> {
    assertRecognitionLeaseAvailable(this.snapshot, 'ptt')
    await this.pttCoordinator.start()
  }

  async stopPtt(): Promise<void> {
    await this.pttCoordinator.stop()
  }

  async copyLatestPttText(): Promise<void> {
    await this.pttCoordinator.copyLatestText()
  }

  async startMeeting(input?: StartMeetingCommand): Promise<void> {
    assertRecognitionLeaseAvailable(this.snapshot, 'meeting')
    await this.meetingCoordinator.start(input)
  }

  async stopMeeting(): Promise<void> {
    await this.meetingCoordinator.stop()
  }

  setLocalServiceStatus(status: LocalServiceStatus): void {
    this.snapshot = {
      ...this.snapshot,
      services: {
        ...this.snapshot.services,
        localService: status
      }
    }
    this.emitSnapshot()
  }

  private emitSnapshot(): void {
    const snapshot = freezeRuntimeSnapshot(this.snapshot)

    for (const listener of this.listeners) {
      listener(snapshot)
    }
  }

  private emitNotification(notification: RuntimeNotification): void {
    for (const listener of this.notificationListeners) {
      listener(notification)
    }
  }
}
