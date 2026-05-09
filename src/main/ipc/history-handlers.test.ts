import { describe, expect, it, vi } from 'vitest'

import { IPC_CHANNELS } from './channels'
import { createHistoryHandlers } from './history-handlers'

describe('createHistoryHandlers', () => {
  it('maps IPC channels to history service methods', async () => {
    const historyService = {
      list: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 }),
      search: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 }),
      get: vi.fn().mockResolvedValue(null),
      delete: vi.fn().mockResolvedValue(true),
      copy: vi.fn().mockResolvedValue(undefined),
      export: vi.fn().mockResolvedValue({ ok: false, error: 'not implemented' })
    }

    const handlers = createHistoryHandlers(historyService)

    await handlers[IPC_CHANNELS.historyList]({ page: 2, pageSize: 5 })
    await handlers[IPC_CHANNELS.historySearch]({ query: 'hello' })
    await handlers[IPC_CHANNELS.historyGet]('tx-1')
    await handlers[IPC_CHANNELS.historyDelete]('tx-1')
    await handlers[IPC_CHANNELS.historyCopy]('tx-1', 'plain_text')
    await handlers[IPC_CHANNELS.historyExport]('tx-1', 'json')

    expect(historyService.list).toHaveBeenCalledWith({ page: 2, pageSize: 5 })
    expect(historyService.search).toHaveBeenCalledWith({ query: 'hello' })
    expect(historyService.get).toHaveBeenCalledWith('tx-1')
    expect(historyService.delete).toHaveBeenCalledWith('tx-1')
    expect(historyService.copy).toHaveBeenCalledWith('tx-1', 'plain_text')
    expect(historyService.export).toHaveBeenCalledWith('tx-1', 'json')
  })

  it('uses an empty list query by default', async () => {
    const historyService = {
      list: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 }),
      search: vi.fn(),
      get: vi.fn(),
      delete: vi.fn(),
      copy: vi.fn(),
      export: vi.fn()
    }

    const handlers = createHistoryHandlers(historyService)

    await handlers[IPC_CHANNELS.historyList]()

    expect(historyService.list).toHaveBeenCalledWith({})
  })
})
