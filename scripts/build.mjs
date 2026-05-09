import { execFile as execFileCallback } from 'node:child_process'
import { mkdir, rm, writeFile, cp } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { build } from 'esbuild'

const execFile = promisify(execFileCallback)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const distDir = path.join(rootDir, 'dist')
const windowsHotkeyProjectDir = path.join(rootDir, 'native', 'windows-hotkey-helper')
const windowsHotkeyOutputDir = path.join(distDir, 'resources', 'windows-hotkey-helper')
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

await writeFile(
  path.join(distDir, 'renderer/index.html'),
  `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>JustSay V2</title>
    <style>
      :root {
        color-scheme: dark;
        font-family: "Segoe UI", sans-serif;
        background: #10161f;
        color: #eff4fb;
      }
      body {
        margin: 0;
        min-height: 100vh;
        background:
          radial-gradient(circle at top, rgba(87, 143, 255, 0.22), transparent 38%),
          linear-gradient(180deg, #0f1722 0%, #10161f 48%, #0c1118 100%);
      }
      #root {
        min-height: 100vh;
      }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./index.js"></script>
  </body>
</html>`,
  'utf8'
)

await cp(path.join(rootDir, 'resources'), path.join(distDir, 'resources'), {
  recursive: true,
  force: true
})
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
