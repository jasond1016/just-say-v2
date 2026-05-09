import path from 'node:path'

export type AppPaths = {
  preloadPath: string
  resourcesPath: string
  rendererIndexPath: string
  iconPath: string
}

export function resolveAppPaths(baseDir: string): AppPaths {
  const resourcesPath = path.join(baseDir, '../resources')

  return {
    preloadPath: path.join(baseDir, '../preload/index.js'),
    resourcesPath,
    rendererIndexPath: path.join(baseDir, '../renderer/index.html'),
    iconPath: path.join(resourcesPath, 'icon.png')
  }
}
