import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { freezeRuntimeSnapshot } from '../../core/runtime/freeze-runtime-snapshot'
import type {
  AppRuntimeSnapshot,
  DiagnosticBundle,
  DiagnosticBundleResult,
  DiagnosticEvent,
  LocalServiceStatus
} from '../../shared/api-types'

export type DiagnosticsServiceOptions = {
  exportDir: string
  appVersion: string
  now?: () => number
  maxEvents?: number
  selectedProfileProvider?: () => string
}

export class DiagnosticsService {
  private readonly now: () => number
  private readonly maxEvents: number
  private recentEvents: DiagnosticEvent[] = []
  private latestFailedSession: AppRuntimeSnapshot | undefined
  private localServiceStatus: LocalServiceStatus = 'stopped'

  constructor(private readonly options: DiagnosticsServiceOptions) {
    this.now = options.now ?? Date.now
    this.maxEvents = options.maxEvents ?? 200
  }

  record(event: DiagnosticEvent): void {
    this.recentEvents = [...this.recentEvents, event].slice(-this.maxEvents)
  }

  setLocalServiceStatus(status: LocalServiceStatus): void {
    this.localServiceStatus = status
  }

  setLatestFailedSession(snapshot: AppRuntimeSnapshot): void {
    this.latestFailedSession = freezeRuntimeSnapshot(snapshot)
  }

  clearLatestFailedSession(): void {
    this.latestFailedSession = undefined
  }

  getBundle(): DiagnosticBundle {
    return {
      appVersion: this.options.appVersion,
      generatedAt: this.now(),
      selectedProfileId: this.options.selectedProfileProvider?.() ?? 'unknown',
      localService: this.localServiceStatus,
      recentEvents: this.recentEvents.map(cloneDiagnosticEvent),
      ...(this.latestFailedSession ? { latestFailedSession: freezeRuntimeSnapshot(this.latestFailedSession) } : {})
    }
  }

  async export(): Promise<DiagnosticBundleResult> {
    try {
      await mkdir(this.options.exportDir, { recursive: true })
      const outputPath = path.join(this.options.exportDir, `diagnostics-${this.now()}.json`)
      await writeFile(outputPath, JSON.stringify(this.getBundle(), null, 2), 'utf8')

      return {
        ok: true,
        path: outputPath
      }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to export diagnostics'
      }
    }
  }

  async exportDiagnostics(): Promise<DiagnosticBundleResult> {
    return this.export()
  }
}

function cloneDiagnosticEvent(event: DiagnosticEvent): DiagnosticEvent {
  return {
    ...event,
    ...(event.type === 'capture-started' ? { sources: [...event.sources] } : {})
  } as DiagnosticEvent
}
