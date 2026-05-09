import type { AppRuntimeSnapshot } from '../../../shared/api-types'
import { INITIAL_RUNTIME_SNAPSHOT } from '../../../shared/runtime-snapshot'
export { INITIAL_RUNTIME_SNAPSHOT }

export class RuntimeStore {
  private snapshot: AppRuntimeSnapshot = INITIAL_RUNTIME_SNAPSHOT

  getSnapshot(): AppRuntimeSnapshot {
    return this.snapshot
  }

  setSnapshot(snapshot: AppRuntimeSnapshot): void {
    this.snapshot = snapshot
  }

  async refresh(api = window.justSay): Promise<AppRuntimeSnapshot> {
    if (!api) {
      throw new Error('window.justSay is not available')
    }

    const snapshot = await api.getRuntime()
    this.setSnapshot(snapshot)
    return this.getSnapshot()
  }

  async hydrate(api = window.justSay): Promise<AppRuntimeSnapshot> {
    return this.refresh(api)
  }
}
