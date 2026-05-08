import type { AppApi } from '../preload/api'

declare global {
  interface Window {
    justSay?: AppApi
  }
}

export {}
