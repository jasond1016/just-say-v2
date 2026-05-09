import type { AppApi } from '../preload/api'
import type { CaptureApi } from '../preload/capture'

declare global {
  interface Window {
    justSay?: AppApi
    justSayCapture?: CaptureApi
  }
}

export {}
