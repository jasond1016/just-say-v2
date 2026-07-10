import type { LocalRuntimeFamilyId, RuntimeIdentity } from '../../shared/api-types'
import type {
  LocalServiceClientMessage,
  LocalServiceServerMessage
} from '../../shared/local-service-types'
import type { SessionMode } from '../../shared/primitive-types'
import type { LocalServiceHealthResult } from './local-service-supervisor'

export interface WebSocketLike {
  addEventListener(type: 'message', listener: (event: { data: string }) => void): void
  addEventListener(type: 'error', listener: (event: unknown) => void): void
  addEventListener(type: 'open', listener: () => void): void
  addEventListener(type: 'close', listener: () => void): void
  send(data: string): void
  close(): void
}

export type LocalServiceProtocolClientOptions = {
  webSocketFactory?: (url: string) => WebSocketLike
  healthTimeoutMs?: number
}

export class LocalServiceProtocolClient {
  private readonly webSocketFactory: (url: string) => WebSocketLike
  private readonly healthTimeoutMs: number

  constructor(options: LocalServiceProtocolClientOptions = {}) {
    this.webSocketFactory = options.webSocketFactory ?? defaultWebSocketFactory
    this.healthTimeoutMs = options.healthTimeoutMs ?? 10_000
  }

  async healthCheck(
    url: string,
    fallbackIdentity: RuntimeIdentity
  ): Promise<LocalServiceHealthResult> {
    const response = await sendLocalServiceRequest(
      this.webSocketFactory,
      url,
      { type: 'health-check' },
      this.healthTimeoutMs
    )

    return parseHealthStatusResponse(response, fallbackIdentity)
  }

  async prewarm(
    url: string,
    input: {
      mode: SessionMode
      language: string
    },
    fallbackIdentity: RuntimeIdentity
  ): Promise<LocalServiceHealthResult> {
    const response = await sendLocalServiceRequest(
      this.webSocketFactory,
      url,
      {
        type: 'prewarm',
        mode: input.mode,
        language: input.language
      },
      this.healthTimeoutMs
    )

    if (response.type === 'prewarm-complete') {
      return this.healthCheck(url, fallbackIdentity)
    }

    return parseHealthStatusResponse(response, fallbackIdentity)
  }
}

export async function sendLocalServiceRequest(
  webSocketFactory: (url: string) => WebSocketLike,
  url: string,
  message: LocalServiceClientMessage,
  timeoutMs: number
): Promise<LocalServiceServerMessage> {
  return new Promise<LocalServiceServerMessage>((resolve, reject) => {
    const socket = webSocketFactory(url)
    const timeout = setTimeout(() => {
      socket.close()
      reject(new Error('Timed out waiting for local service response'))
    }, timeoutMs)

    const settle = (callback: () => void) => {
      clearTimeout(timeout)
      socket.close()
      callback()
    }

    socket.addEventListener('open', () => {
      socket.send(JSON.stringify(message))
    })
    socket.addEventListener('message', (event) => {
      settle(() => resolve(JSON.parse(event.data) as LocalServiceServerMessage))
    })
    socket.addEventListener('error', (event) => {
      settle(() => reject(normalizeSocketError(event)))
    })
    socket.addEventListener('close', () => {
      // ignored; timeout/error path handles failures
    })
  })
}

export function defaultWebSocketFactory(url: string): WebSocketLike {
  return new WebSocket(url) as unknown as WebSocketLike
}

export function createLocalServiceUrl(host: string, port: number): string {
  return `ws://${host}:${port}`
}

function parseHealthStatusResponse(
  response: LocalServiceServerMessage,
  fallbackIdentity: RuntimeIdentity
): LocalServiceHealthResult {
  if (response.type !== 'health-status') {
    return {
      ok: false,
      runtimeFamilyId: fallbackIdentity.runtimeFamilyId as LocalRuntimeFamilyId,
      modelIdentifier: fallbackIdentity.modelIdentifier,
      readiness: 'prewarm-required',
      detail: {
        reason: 'unexpected-response',
        responseType: response.type
      }
    }
  }

  return {
    ok: response.ok,
    runtimeFamilyId: response.runtimeFamilyId,
    modelIdentifier: response.modelIdentifier,
    readiness: response.readiness,
    ...(response.detail ? { detail: response.detail } : {})
  }
}

function normalizeSocketError(errorLike: unknown): Error {
  if (errorLike instanceof Error) {
    return errorLike
  }

  return new Error('Local service websocket request failed')
}
