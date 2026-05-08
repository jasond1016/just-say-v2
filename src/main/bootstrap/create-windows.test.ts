import { describe, expect, it } from 'vitest'

import { createWindows } from './create-windows'

describe('createWindows', () => {
  it('creates the main and capture windows with the expected preload path and urls', async () => {
    const calls: Array<{
      title: string
      show: boolean
      preload?: string
      urls: string[]
    }> = []

    const windows = await createWindows({
      browserWindowFactory: ({ title, show, webPreferences }) => {
        const record = {
          title,
          show,
          urls: [] as string[],
          ...(webPreferences?.preload ? { preload: webPreferences.preload } : {})
        }
        calls.push(record)

        return {
          loadURL(url: string) {
            record.urls.push(url)
          }
        }
      },
      rendererUrl: 'app://renderer',
      captureUrl: 'app://capture',
      preloadPath: '/abs/preload.js'
    })

    expect(calls).toEqual([
      {
        title: 'JustSay V2',
        show: true,
        preload: '/abs/preload.js',
        urls: ['app://renderer']
      },
      {
        title: 'JustSay Capture',
        show: false,
        preload: '/abs/preload.js',
        urls: ['app://capture']
      }
    ])
    expect(windows.mainWindow).toBeDefined()
    expect(windows.captureWindow).toBeDefined()
  })
})
