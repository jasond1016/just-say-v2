import type {
  AppRuntimeSnapshot,
  ExportFormat,
  ExportResult,
  RuntimeNotification,
  StartMeetingCommand
} from '../../shared/api-types'
import type { SessionMode } from '../../shared/primitive-types'
import type { SessionHandlerService } from '../ipc/session-handlers'
import type { LiveSessionActionsService } from './live-session-actions-service'
import type { SessionCoordinator } from './session-coordinator'

export class SessionService implements SessionHandlerService {
  constructor(
    private readonly coordinator: SessionCoordinator,
    private readonly liveActions: LiveSessionActionsService
  ) {}

  getRuntimeSnapshot(): AppRuntimeSnapshot {
    return this.coordinator.getRuntimeSnapshot()
  }

  onSnapshot(listener: (snapshot: AppRuntimeSnapshot) => void): () => void {
    return this.coordinator.onSnapshot(listener)
  }

  onNotification(listener: (notification: RuntimeNotification) => void): () => void {
    return this.coordinator.onNotification(listener)
  }

  prewarm(mode: SessionMode): Promise<void> {
    return this.coordinator.prewarm(mode)
  }

  startPtt(): Promise<void> {
    return this.coordinator.startPtt()
  }

  stopPtt(): Promise<void> {
    return this.coordinator.stopPtt()
  }

  copyLatestPttText(): Promise<void> {
    return this.coordinator.copyLatestPttText()
  }

  startMeeting(input?: StartMeetingCommand): Promise<void> {
    return this.coordinator.startMeeting(input)
  }

  stopMeeting(): Promise<void> {
    return this.coordinator.stopMeeting()
  }

  copyLiveSession(): Promise<void> {
    return this.liveActions.copyPlainText()
  }

  exportLiveSession(format: ExportFormat): Promise<ExportResult> {
    return this.liveActions.export(format)
  }
}
