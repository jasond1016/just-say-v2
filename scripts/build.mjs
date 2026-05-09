import { execFile as execFileCallback } from 'node:child_process'
import { mkdir, rm, cp } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { build } from 'esbuild'

const execFile = promisify(execFileCallback)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const distDir = path.join(rootDir, 'dist')
const rendererSourceDir = path.join(rootDir, 'src', 'renderer')
const resourcesSourceDir = path.join(rootDir, 'resources')
const localServiceSourceDir = path.join(resourcesSourceDir, 'local-service')
const resourcesOutputDir = path.join(distDir, 'resources')
const localServiceOutputDir = path.join(resourcesOutputDir, 'local-service')
const windowsHotkeyProjectDir = path.join(rootDir, 'native', 'windows-hotkey-helper')
const windowsHotkeyOutputDir = path.join(resourcesOutputDir, 'windows-hotkey-helper')
const windowsHotkeyExecutablePath = path.join(
  windowsHotkeyOutputDir,
  'JustSayHotkeyHelper.exe'
)

await rm(distDir, { recursive: true, force: true })
await mkdir(path.join(distDir, 'main'), { recursive: true })
await mkdir(path.join(distDir, 'preload'), { recursive: true })
await mkdir(path.join(distDir, 'renderer'), { recursive: true })

await Promise.all([
  build({
    entryPoints: [path.join(rootDir, 'src/main/index.ts')],
    outfile: path.join(distDir, 'main/index.js'),
    platform: 'node',
    format: 'cjs',
    bundle: true,
    target: 'node20',
    external: ['electron', 'node-global-key-listener']
  }),
  build({
    entryPoints: [path.join(rootDir, 'src/preload/entry.ts')],
    outfile: path.join(distDir, 'preload/index.js'),
    platform: 'node',
    format: 'cjs',
    bundle: true,
    target: 'node20',
    external: ['electron']
  }),
  build({
    entryPoints: [path.join(rootDir, 'src/renderer/main.tsx')],
    outfile: path.join(distDir, 'renderer/index.js'),
    platform: 'browser',
    format: 'esm',
    bundle: true,
    target: 'es2022',
    jsx: 'automatic'
  })
])

await Promise.all([
  cp(path.join(rendererSourceDir, 'index.html'), path.join(distDir, 'renderer', 'index.html')),
  cp(path.join(rendererSourceDir, 'base.css'), path.join(distDir, 'renderer', 'base.css')),
  cp(path.join(rendererSourceDir, 'styles'), path.join(distDir, 'renderer', 'styles'), {
    recursive: true,
    force: true
  })
])

await mkdir(resourcesOutputDir, { recursive: true })
await cp(path.join(resourcesSourceDir, 'icon.png'), path.join(resourcesOutputDir, 'icon.png'))
await mkdir(localServiceOutputDir, { recursive: true })
await Promise.all([
  cp(path.join(localServiceSourceDir, '.python-version'), path.join(localServiceOutputDir, '.python-version')),
  cp(path.join(localServiceSourceDir, 'README.md'), path.join(localServiceOutputDir, 'README.md')),
  cp(path.join(localServiceSourceDir, 'pyproject.toml'), path.join(localServiceOutputDir, 'pyproject.toml')),
  cp(path.join(localServiceSourceDir, 'service.py'), path.join(localServiceOutputDir, 'service.py')),
  cp(path.join(localServiceSourceDir, 'uv.lock'), path.join(localServiceOutputDir, 'uv.lock'))
])
await publishWindowsHotkeyHelper()

async function publishWindowsHotkeyHelper() {
  if (process.platform !== 'win32') {
    return
  }

  await rm(windowsHotkeyOutputDir, { recursive: true, force: true })
  await mkdir(windowsHotkeyOutputDir, { recursive: true })

  await execFile(
    'go',
    [
      'build',
      '-trimpath',
      '-ldflags=-s -w',
      '-o',
      windowsHotkeyExecutablePath,
      '.'
    ],
    {
      cwd: windowsHotkeyProjectDir,
      windowsHide: true
    }
  )
}
