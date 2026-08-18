import { execFile as execFileCallback } from 'node:child_process'
import { access, cp, mkdir, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createWriteStream } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const cacheDir = path.join(rootDir, '.cache', 'native-sensevoice')
const sourceDir = path.join(cacheDir, 'source')
const buildDir = path.join(cacheDir, 'build')
const resourceDir = path.join(rootDir, 'resources', 'local-service-native')
const binaryDir = path.join(resourceDir, 'bin')
const modelDir = path.join(resourceDir, 'models')
const upstreamCommit = 'b054623cca8f015b73ec471dce4f473ac47413da'
const patchPath = path.join(
  rootDir,
  'native',
  'sensevoice-server',
  'patches',
  '0001-justsay-realtime-metadata.patch'
)
const forceCuda = process.argv.includes('--cuda')
const forceCpu = process.argv.includes('--cpu')
if (forceCuda && forceCpu) {
  throw new Error('Choose only one native SenseVoice backend override: --cuda or --cpu')
}
const cudaDetected =
  (await commandSucceeds('nvcc', ['--version'])) &&
  (await commandSucceeds('nvidia-smi', ['--list-gpus']))
const cudaEnabled = forceCuda || (!forceCpu && cudaDetected)
const cmakeCommand = await resolveCmakeCommand()

if (!forceCuda && !forceCpu) {
  console.log(`Auto-detected native backend: ${cudaEnabled ? 'CUDA' : 'CPU'}`)
}

await mkdir(cacheDir, { recursive: true })
await prepareSource()
await buildServer()
await installBinary()
await Promise.all([
  downloadIfMissing(
    'https://huggingface.co/FunAudioLLM/SenseVoiceSmall-GGUF/resolve/main/sensevoice-small-q8.gguf',
    path.join(modelDir, 'sensevoice-small-q8.gguf')
  ),
  downloadIfMissing(
    'https://huggingface.co/FunAudioLLM/fsmn-vad-GGUF/resolve/main/fsmn-vad.gguf',
    path.join(modelDir, 'fsmn-vad.gguf')
  )
])

console.log(`Native SenseVoice is ready in ${resourceDir}`)
console.log(`Build backend: ${cudaEnabled ? 'CUDA' : 'CPU'}`)

async function prepareSource() {
  if (!(await exists(path.join(sourceDir, '.git')))) {
    await rm(sourceDir, { recursive: true, force: true })
    await execFile('git', [
      'clone',
      '--filter=blob:none',
      'https://github.com/QwenAudio/SenseVoice.git',
      sourceDir
    ])
  }

  await execFile('git', ['fetch', 'origin', upstreamCommit], { cwd: sourceDir })
  await execFile('git', ['reset', '--hard', upstreamCommit], { cwd: sourceDir })
  await execFile('git', ['clean', '-fdx'], { cwd: sourceDir })
  await execFile('git', ['apply', '--unidiff-zero', '--check', patchPath], { cwd: sourceDir })
  await execFile('git', ['apply', '--unidiff-zero', patchPath], { cwd: sourceDir })
}

async function buildServer() {
  await rm(buildDir, { recursive: true, force: true })
  const sourceRuntimeDir = path.join(sourceDir, 'runtime', 'llama.cpp')
  await execFile(
    cmakeCommand,
    [
      '-S',
      sourceRuntimeDir,
      '-B',
      buildDir,
      '-DCMAKE_BUILD_TYPE=Release',
      `-DGGML_CUDA=${cudaEnabled ? 'ON' : 'OFF'}`
    ],
    { cwd: rootDir }
  )
  await execFile(
    cmakeCommand,
    ['--build', buildDir, '--config', 'Release', '--target', 'sensevoice-server', '--parallel'],
    { cwd: rootDir, maxBuffer: 32 * 1024 * 1024 }
  )
}

async function installBinary() {
  const executableName = process.platform === 'win32' ? 'sensevoice-server.exe' : 'sensevoice-server'
  const candidates = [
    path.join(buildDir, 'bin', executableName),
    path.join(buildDir, 'bin', 'Release', executableName),
    path.join(buildDir, 'Release', executableName)
  ]
  const sourceBinary = await firstExisting(candidates)
  if (!sourceBinary) {
    throw new Error(`Built SenseVoice server was not found in ${buildDir}`)
  }
  await mkdir(binaryDir, { recursive: true })
  await cp(sourceBinary, path.join(binaryDir, executableName))
}

async function downloadIfMissing(url, destination) {
  if (await exists(destination)) {
    return
  }
  await mkdir(path.dirname(destination), { recursive: true })
  const temporaryPath = `${destination}.download`
  await rm(temporaryPath, { force: true })
  console.log(`Downloading ${path.basename(destination)}...`)
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download ${url}: HTTP ${response.status}`)
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(temporaryPath))
  await rename(temporaryPath, destination)
}

async function firstExisting(paths) {
  for (const candidate of paths) {
    if (await exists(candidate)) {
      return candidate
    }
  }
  return null
}

async function exists(filePath) {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

async function commandSucceeds(command, args) {
  try {
    await execFile(command, args)
    return true
  } catch {
    return false
  }
}

async function resolveCmakeCommand() {
  if (await commandSucceeds('cmake', ['--version'])) {
    return 'cmake'
  }

  if (process.platform === 'win32') {
    const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files'
    for (const edition of ['BuildTools', 'Community', 'Professional', 'Enterprise']) {
      const candidate = path.join(
        programFiles,
        'Microsoft Visual Studio',
        '2022',
        edition,
        'Common7',
        'IDE',
        'CommonExtensions',
        'Microsoft',
        'CMake',
        'CMake',
        'bin',
        'cmake.exe'
      )
      if (await exists(candidate)) {
        return candidate
      }
    }
  }

  throw new Error(
    'CMake was not found. On Windows, add "C++ CMake tools for Windows" in Visual Studio Installer.'
  )
}
