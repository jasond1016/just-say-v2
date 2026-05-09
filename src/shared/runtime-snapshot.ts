import type { AppRuntimeSnapshot } from './api-types'

export const INITIAL_RUNTIME_SNAPSHOT: AppRuntimeSnapshot = {
  ptt: {
    status: 'idle'
  },
  liveSession: null,
  services: {
    localService: 'stopped'
  }
}
