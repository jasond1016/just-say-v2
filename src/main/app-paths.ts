import path from 'node:path'

export type AppPaths = {
  preloadPath: string
  resourcesPath: string
  localServicePath: string
  rendererIndexPath: string
  iconPath: string
}

export function resolveAppPaths(baseDir: string): AppPaths {
  const isDevRun = path.basename(baseDir) === 'main' && path.basename(path.dirname(baseDir)) === 'dist'
  const appRoot = isDevRun ? path.resolve(baseDir, '../..') : path.resolve(baseDir, '..')
  const buildRoot = isDevRun ? path.join(appRoot, 'dist') : appRoot
  const resourcesPath = path.join(buildRoot, 'resources')
  const localServicePath = isDevRun
    ? path.join(appRoot, 'resources', 'local-service')
    : path.join(resourcesPath, 'local-service')
  const rendererRoot = isDevRun ? path.join(buildRoot, 'renderer') : path.join(appRoot, 'renderer')
  const preloadRoot = isDevRun ? path.join(buildRoot, 'preload') : path.join(appRoot, 'preload')

  return {
    preloadPath: path.join(preloadRoot, 'index.js'),
    resourcesPath,
    localServicePath,
    rendererIndexPath: path.join(rendererRoot, 'index.html'),
    iconPath: path.join(resourcesPath, 'icon.png')
  }
}
