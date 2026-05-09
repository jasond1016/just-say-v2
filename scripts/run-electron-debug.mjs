import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const electronBinary = require('electron')
const remoteDebuggingPort = process.env.JUSTSAY_REMOTE_DEBUGGING_PORT ?? '9222'
const env = {
  ...process.env,
  JUSTSAY_REMOTE_DEBUGGING_PORT: remoteDebuggingPort
}

await import('./build.mjs')
await run(electronBinary, [`--remote-debugging-port=${remoteDebuggingPort}`, '.'], env)

function run(command, args, childEnv) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: rootDir,
      env: childEnv,
      stdio: 'inherit'
    })

    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve()
        return
      }

      reject(
        new Error(
          signal
            ? `${command} terminated with signal ${signal}`
            : `${command} exited with code ${code ?? 'unknown'}`
        )
      )
    })
  })
}
