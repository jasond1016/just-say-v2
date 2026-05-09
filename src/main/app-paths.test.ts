import { describe, expect, it } from 'vitest'

import { resolveAppPaths } from './app-paths'

describe('resolveAppPaths', () => {
  it('uses source resources during dist-based development runs', () => {
    const paths = resolveAppPaths('C:\\my_project\\just-say-v2\\dist\\main')

    expect(paths).toEqual({
      preloadPath: 'C:\\my_project\\just-say-v2\\dist\\preload\\index.js',
      resourcesPath: 'C:\\my_project\\just-say-v2\\dist\\resources',
      localServicePath: 'C:\\my_project\\just-say-v2\\resources\\local-service',
      rendererIndexPath: 'C:\\my_project\\just-say-v2\\dist\\renderer\\index.html',
      iconPath: 'C:\\my_project\\just-say-v2\\dist\\resources\\icon.png'
    })
  })

  it('resolves the tray and window icon from the published resources directory', () => {
    const paths = resolveAppPaths('C:\\my_project\\just-say-v2\\release\\main')

    expect(paths).toEqual({
      preloadPath: 'C:\\my_project\\just-say-v2\\release\\preload\\index.js',
      resourcesPath: 'C:\\my_project\\just-say-v2\\release\\resources',
      localServicePath: 'C:\\my_project\\just-say-v2\\release\\resources\\local-service',
      rendererIndexPath: 'C:\\my_project\\just-say-v2\\release\\renderer\\index.html',
      iconPath: 'C:\\my_project\\just-say-v2\\release\\resources\\icon.png'
    })
  })
})
