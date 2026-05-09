import { describe, expect, it, vi } from 'vitest'

import { IPC_CHANNELS } from './channels'
import { createDiagnosticsHandlers } from './diagnostics-handlers'

describe('createDiagnosticsHandlers', () => {
  it('maps diagnostics export to the diagnostics service', async () => {
    const diagnosticsService = {
      exportDiagnostics: vi.fn().mockResolvedValue({ ok: true, path: 'C:/tmp/diag.json' })
    }

    const handlers = createDiagnosticsHandlers(diagnosticsService)
    await expect(handlers[IPC_CHANNELS.diagnosticsExport]()).resolves.toEqual({
      ok: true,
      path: 'C:/tmp/diag.json'
    })
    expect(diagnosticsService.exportDiagnostics).toHaveBeenCalledTimes(1)
  })
})
