import type { OutputMethod } from '../../shared/api-types'

export interface ClipboardOutputTarget {
  writeText(text: string): Promise<void>
}

export interface PopupOutputTarget {
  showText(text: string): Promise<void>
}

export interface InputOutputTarget {
  sendText(text: string): Promise<void>
}

export type OutputDispatchResult = {
  requestedMethod: OutputMethod
  methodUsed: OutputMethod
  fallbackReason?: string
}

export class OutputDispatcher {
  constructor(
    private readonly dependencies: {
      clipboard: ClipboardOutputTarget
      popup: PopupOutputTarget
      input?: InputOutputTarget
    }
  ) {}

  async deliver(input: { text: string; method: OutputMethod }): Promise<OutputDispatchResult> {
    switch (input.method) {
      case 'clipboard':
        return this.deliverToClipboard(input.text, input.method)
      case 'popup':
        try {
          await this.dependencies.popup.showText(input.text)
          return {
            requestedMethod: input.method,
            methodUsed: 'popup'
          }
        } catch (error) {
          throw createOutputDeliveryError(error, input)
        }
      case 'simulate_input':
        if (this.dependencies.input) {
          try {
            await this.dependencies.input.sendText(input.text)
            return {
              requestedMethod: input.method,
              methodUsed: 'simulate_input'
            }
          } catch (error) {
            const fallbackReason = error instanceof Error ? error.message : 'Simulated input failed.'

            try {
              const clipboardDelivery = await this.deliverToClipboard(input.text, input.method)
              return {
                ...clipboardDelivery,
                fallbackReason
              }
            } catch (clipboardError) {
              throw createOutputDeliveryError(clipboardError, input, fallbackReason)
            }
          }
        }

        return this.deliverToClipboard(input.text, input.method, 'Simulated input is unavailable.')
      default:
        return assertNever(input.method)
    }
  }

  private async deliverToClipboard(
    text: string,
    requestedMethod: OutputMethod,
    fallbackReason?: string
  ): Promise<OutputDispatchResult> {
    try {
      await this.dependencies.clipboard.writeText(text)
      return {
        requestedMethod,
        methodUsed: 'clipboard',
        ...(fallbackReason ? { fallbackReason } : {})
      }
    } catch (error) {
      throw createOutputDeliveryError(error, { text, method: requestedMethod }, fallbackReason)
    }
  }
}

function assertNever(value: never): never {
  throw new Error(`Unsupported output method: ${String(value)}`)
}

function createOutputDeliveryError(
  errorLike: unknown,
  input: { text: string; method: OutputMethod },
  fallbackReason?: string
): Error {
  const message = errorLike instanceof Error ? errorLike.message : 'Unknown output delivery failure'
  const error = new Error(message)
  ;(error as Error & {
    payload?: {
      code: 'E_OUTPUT_DELIVERY'
      message: string
      retryable: true
      detail: Record<string, unknown>
    }
  }).payload = {
    code: 'E_OUTPUT_DELIVERY',
    message,
    retryable: true,
    detail: {
      requestedMethod: input.method,
      transcriptText: input.text,
      ...(fallbackReason ? { fallbackReason } : {})
    }
  }

  return error
}
