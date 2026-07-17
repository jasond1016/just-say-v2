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

export type SidecarProtocolOptions = {
  webSocketFactory?: (url: string) => WebSocketLike
  healthTimeoutMs?: number
  connectTimeoutMs?: number
}

export type SidecarSessionStreamHandlers = {
  onMessage: (message: LocalServiceServerMessage) => void
  onError?: (message: string) => void
  onClose?: (info: { opened: boolean }) => void
}

export type SidecarSessionStream = {
  send: (message: LocalServiceClientMessage) => void
  close: () => void
}

/**
 * Deep module for Managed Local / Remote Service WebSocket framing:
 * short request/response (health, prewarm) and long-lived recognition streams.
 * One sidecar instance remains one Runtime Family (ADR-0001); Prewarm stays explicit.
 */
export class SidecarProtocol {
  private readonly webSocketFactory: (url: string) => WebSocketLike
  private readonly healthTimeoutMs: number
  private readonly connectTimeoutMs: number

  constructor(options: SidecarProtocolOptions = {}) {
    this.webSocketFactory = options.webSocketFactory ?? defaultWebSocketFactory
    this.healthTimeoutMs = options.healthTimeoutMs ?? 10_000
    this.connectTimeoutMs = options.connectTimeoutMs ?? 5_000
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

  async openSessionStream(
    url: string,
    handlers: SidecarSessionStreamHandlers
  ): Promise<SidecarSessionStream> {
    const socket = this.webSocketFactory(url)
    let isOpen = false
    let hasSettled = false
    let closed = false

    const waitForOpen = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        hasSettled = true
        socket.close()
        reject(new Error('Timed out waiting for local engine websocket to connect'))
      }, this.connectTimeoutMs)

      const settle = (callback: () => void) => {
        if (hasSettled) {
          return
        }

        hasSettled = true
        clearTimeout(timeout)
        callback()
      }

      socket.addEventListener('open', () => {
        isOpen = true
        settle(resolve)
      })
      socket.addEventListener('error', (event) => {
        const message = normalizeSocketErrorMessage(event)
        handlers.onError?.(message)

        if (!isOpen) {
          settle(() => reject(new Error(message)))
        }
      })
      socket.addEventListener('close', () => {
        if (!isOpen) {
          settle(() => reject(new Error('Local engine websocket closed before connecting')))
          return
        }

        if (closed) {
          return
        }

        handlers.onClose?.({ opened: true })
      })
    })

    socket.addEventListener('message', (event) => {
      handlers.onMessage(JSON.parse(event.data) as LocalServiceServerMessage)
    })

    try {
      await waitForOpen
    } catch (error) {
      socket.close()
      throw error
    }

    return {
      send(message: LocalServiceClientMessage) {
        socket.send(JSON.stringify(message))
      },
      close() {
        closed = true
        socket.close()
      }
    }
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
  return new Error(normalizeSocketErrorMessage(errorLike))
}

function normalizeSocketErrorMessage(errorLike: unknown): string {
  if (errorLike instanceof Error) {
    return errorLike.message
  }

  return 'Local service websocket request failed'
}
