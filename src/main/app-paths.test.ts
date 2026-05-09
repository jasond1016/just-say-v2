import { describe, expect, it } from 'vitest'

import { resolveAppPaths } from './app-paths'

describe('resolveAppPaths', () => {
  it('resolves the tray and window icon from the published resources directory', () => {
    const paths = resolveAppPaths('C:\\my_project\\just-say-v2\\dist\\main')

    expect(paths).toEqual({
      preloadPath: 'C:\\my_project\\just-say-v2\\dist\\preload\\index.js',
      resourcesPath: 'C:\\my_project\\just-say-v2\\dist\\resources',
      rendererIndexPath: 'C:\\my_project\\just-say-v2\\dist\\renderer\\index.html',
      iconPath: 'C:\\my_project\\just-say-v2\\dist\\resources\\icon.png'
    })
  })
})
