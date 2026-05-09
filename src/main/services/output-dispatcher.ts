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
  methodUsed: OutputMethod
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
        await this.dependencies.clipboard.writeText(input.text)
        return {
          methodUsed: 'clipboard'
        }
      case 'popup':
        await this.dependencies.popup.showText(input.text)
        return {
          methodUsed: 'popup'
        }
      case 'simulate_input':
        if (this.dependencies.input) {
          try {
            await this.dependencies.input.sendText(input.text)
            return {
              methodUsed: 'simulate_input'
            }
          } catch {
            // fall through to clipboard fallback
          }
        }

        await this.dependencies.clipboard.writeText(input.text)
        return {
          methodUsed: 'clipboard'
        }
      default:
        return assertNever(input.method)
    }
  }
}

function assertNever(value: never): never {
  throw new Error(`Unsupported output method: ${String(value)}`)
}
