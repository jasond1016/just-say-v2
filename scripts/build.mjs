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
<html lang="en" data-theme="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>JustSay</title>
    <style>
      *, *::before, *::after { box-sizing: border-box; margin: 0; }
      :root {
        color-scheme: dark;
        --bg-page: oklch(0.145 0.008 55);
        --bg-surface: oklch(0.185 0.008 55);
        --bg-elevated: oklch(0.225 0.007 55);
        --bg-hover: oklch(0.205 0.007 55);
        --border: oklch(0.275 0.006 55);
        --border-subtle: oklch(0.22 0.005 55);
        --text-primary: oklch(0.91 0.008 75);
        --text-secondary: oklch(0.64 0.01 65);
        --text-tertiary: oklch(0.48 0.007 60);
        --accent: oklch(0.72 0.13 32);
        --accent-muted: oklch(0.72 0.13 32 / 0.14);
        --accent-text: oklch(0.78 0.10 32);
        --accent-on: oklch(0.18 0.02 32);
        --danger: oklch(0.68 0.16 22);
        --danger-muted: oklch(0.68 0.16 22 / 0.12);
        --success: oklch(0.70 0.13 152);
        --radius: 3px;
        --font-sans: "Segoe UI Variable", "Segoe UI", system-ui, sans-serif;
        --font-mono: "Cascadia Mono", Consolas, monospace;
      }
      [data-theme="light"] {
        color-scheme: light;
        --bg-page: oklch(0.965 0.006 75);
        --bg-surface: oklch(0.99 0.003 75);
        --bg-elevated: oklch(1.0 0 0);
        --bg-hover: oklch(0.955 0.005 75);
        --border: oklch(0.86 0.008 65);
        --border-subtle: oklch(0.92 0.005 65);
        --text-primary: oklch(0.22 0.01 55);
        --text-secondary: oklch(0.48 0.01 55);
        --text-tertiary: oklch(0.64 0.008 55);
        --accent: oklch(0.58 0.15 32);
        --accent-muted: oklch(0.58 0.15 32 / 0.10);
        --accent-text: oklch(0.50 0.14 32);
        --accent-on: oklch(0.98 0.005 32);
        --danger: oklch(0.55 0.18 22);
        --danger-muted: oklch(0.55 0.18 22 / 0.08);
        --success: oklch(0.55 0.15 152);
      }
      html {
        font-family: var(--font-sans);
        background: var(--bg-page);
        color: var(--text-primary);
        -webkit-font-smoothing: antialiased;
        text-rendering: optimizeLegibility;
      }
      body { margin: 0; min-height: 100vh; }
      #root { min-height: 100vh; }
      ::-webkit-scrollbar { width: 6px; height: 6px; }
      ::-webkit-scrollbar-track { background: transparent; }
      ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
      ::-webkit-scrollbar-thumb:hover { background: var(--text-tertiary); }
      :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
      @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.4; }
      }
      @media (prefers-reduced-motion: reduce) {
        *, *::before, *::after {
          animation-duration: 0.01ms !important;
          transition-duration: 0.01ms !important;
        }
      }
      /* Interactive feedback */
      button, [role="button"] { transition: filter 0.15s ease; }
      button:not(:disabled):hover, [role="button"]:hover { filter: brightness(1.15); }
      [data-theme="light"] button:not(:disabled):hover,
      [data-theme="light"] [role="button"]:hover { filter: brightness(0.92); }
      button:not(:disabled):active, [role="button"]:active { filter: brightness(0.85); }
      /* Nav buttons: visible bg hover since they are transparent */
      nav button { transition: filter 0.15s ease, background 0.15s ease; }
      nav button:not([data-active]):hover { background: var(--bg-elevated) !important; }
      nav button:not([data-active]):active { background: var(--border-subtle) !important; }
      /* Input / select focus */
      input:focus-visible, select:focus-visible {
        border-color: var(--accent) !important;
        outline: none;
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
