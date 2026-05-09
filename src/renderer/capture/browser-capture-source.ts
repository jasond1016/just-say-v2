import type { AudioChunk } from '../../shared/api-types'
import type { CaptureSource } from '../../shared/primitive-types'
import type { CaptureSourceInstance, CaptureSourceManager } from './capture-runtime'

type CreateBrowserCaptureSourceManagerOptions = {
  navigatorLike?: Navigator
  audioContextFactory?: (options: AudioContextOptions) => AudioContext
}

export function createBrowserCaptureSourceManager(
  options: CreateBrowserCaptureSourceManagerOptions = {}
): CaptureSourceManager {
  const navigatorLike = options.navigatorLike ?? navigator
  const audioContextFactory =
    options.audioContextFactory ?? ((audioOptions) => new AudioContext(audioOptions))

  return {
    async createSource(input) {
      const mediaStream = await requestMediaStream(navigatorLike, input.source, {
        ...(input.microphoneDeviceId ? { microphoneDeviceId: input.microphoneDeviceId } : {}),
        ...(input.systemSourceId ? { systemSourceId: input.systemSourceId } : {})
      })

      return new BrowserCaptureSource(mediaStream, {
        source: input.source,
        sampleRate: input.sampleRate,
        chunkMs: input.chunkMs,
        audioContextFactory
      })
    }
  }
}

type BrowserCaptureSourceOptions = {
  source: CaptureSource
  sampleRate: number
  chunkMs: number
  audioContextFactory: (options: AudioContextOptions) => AudioContext
}

class BrowserCaptureSource implements CaptureSourceInstance {
  private readonly chunkListeners = new Set<(chunk: AudioChunk) => void>()
  private readonly audioContext: AudioContext
  private readonly audioSourceNode: MediaStreamAudioSourceNode
  private readonly processorNode: ScriptProcessorNode
  private readonly chunkSize: number
  private sampleBuffer: Float32Array<ArrayBufferLike> = new Float32Array(0)

  constructor(
    private readonly mediaStream: MediaStream,
    private readonly options: BrowserCaptureSourceOptions
  ) {
    this.audioContext = this.options.audioContextFactory({
      sampleRate: this.options.sampleRate,
      latencyHint: 'interactive'
    })
    this.audioSourceNode = this.audioContext.createMediaStreamSource(this.mediaStream)
    this.processorNode = this.audioContext.createScriptProcessor(4096, 1, 1)
    this.chunkSize = Math.max(1, Math.floor((this.options.sampleRate * this.options.chunkMs) / 1000))

    this.processorNode.onaudioprocess = (event) => {
      const incoming = event.inputBuffer.getChannelData(0)
      this.sampleBuffer = concatFloat32Arrays(this.sampleBuffer, incoming)
      this.flushChunks()
    }

    this.audioSourceNode.connect(this.processorNode)
    this.processorNode.connect(this.audioContext.destination)
  }

  onChunk(listener: (chunk: AudioChunk) => void): () => void {
    this.chunkListeners.add(listener)

    return () => {
      this.chunkListeners.delete(listener)
    }
  }

  async start(): Promise<void> {
    await this.audioContext.resume()
  }

  async stop(): Promise<void> {
    this.flushChunks(true)
    await this.teardown()
  }

  async abort(): Promise<void> {
    await this.teardown()
  }

  private flushChunks(flushRemainder = false): void {
    while (this.sampleBuffer.length >= this.chunkSize || (flushRemainder && this.sampleBuffer.length > 0)) {
      const size = flushRemainder ? this.sampleBuffer.length : this.chunkSize
      const slice = this.sampleBuffer.slice(0, size)
      this.sampleBuffer = this.sampleBuffer.slice(size)

      const chunk: AudioChunk = {
        source: this.options.source,
        data: float32ToPcm16(slice),
        sampleRate: this.options.sampleRate,
        channels: 1,
        timestamp: Date.now()
      }

      for (const listener of this.chunkListeners) {
        listener(chunk)
      }
    }
  }

  private async teardown(): Promise<void> {
    this.processorNode.disconnect()
    this.audioSourceNode.disconnect()
    for (const track of this.mediaStream.getTracks()) {
      track.stop()
    }
    await this.audioContext.close()
  }
}

async function requestMediaStream(
  navigatorLike: Navigator,
  source: CaptureSource,
  options: {
    microphoneDeviceId?: string
    systemSourceId?: string
  }
): Promise<MediaStream> {
  if (source === 'microphone') {
    return navigatorLike.mediaDevices.getUserMedia({
      audio:
        options.microphoneDeviceId && options.microphoneDeviceId !== 'default'
          ? {
              deviceId: {
                exact: options.microphoneDeviceId
              }
            }
          : true,
      video: false
    })
  }

  return navigatorLike.mediaDevices.getDisplayMedia({
    audio: true,
    video: true
  })
}

function concatFloat32Arrays(
  left: Float32Array<ArrayBufferLike>,
  right: Float32Array<ArrayBufferLike>
): Float32Array<ArrayBufferLike> {
  const merged: Float32Array<ArrayBufferLike> = new Float32Array(left.length + right.length)
  merged.set(left)
  merged.set(right, left.length)
  return merged
}

export function float32ToPcm16(input: Float32Array<ArrayBufferLike>): Uint8Array {
  const buffer = new ArrayBuffer(input.length * 2)
  const view = new DataView(buffer)

  for (let index = 0; index < input.length; index += 1) {
    const value = Math.max(-1, Math.min(1, input[index] ?? 0))
    view.setInt16(index * 2, value < 0 ? value * 0x8000 : value * 0x7fff, true)
  }

  return new Uint8Array(buffer)
}
