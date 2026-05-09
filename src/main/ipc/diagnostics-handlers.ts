import type { DiagnosticBundleResult } from '../../shared/api-types'
import { IPC_CHANNELS } from './channels'

export type DiagnosticsHandlerService = {
  exportDiagnostics(): Promise<DiagnosticBundleResult>
}

export type DiagnosticsHandlers = {
  [IPC_CHANNELS.diagnosticsExport]: () => Promise<DiagnosticBundleResult>
}

export function createDiagnosticsHandlers(
  diagnosticsService: DiagnosticsHandlerService
): DiagnosticsHandlers {
  return {
    [IPC_CHANNELS.diagnosticsExport]: async () => diagnosticsService.exportDiagnostics()
  }
}
