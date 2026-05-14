import type { PttHudSnapshot } from '../../shared/api-types'

export interface PttHudWindowLike {
  show(): void
  hide(): void
  isVisible?(): boolean
  showInactive?(): void
  setIgnoreMouseEvents?(ignore: boolean): void
}

type HudStateSource = {
  getSnapshot(): PttHudSnapshot
  onSnapshot(listener: (snapshot: PttHudSnapshot) => void): () => void
}

export class PttHudWindowController {
  private readonly unsubscribe: () => void

  constructor(
    private readonly window: PttHudWindowLike,
    stateSource: HudStateSource
  ) {
    this.unsubscribe = stateSource.onSnapshot((snapshot) => {
      this.applySnapshot(snapshot)
    })
    this.applySnapshot(stateSource.getSnapshot())
  }

  dispose(): void {
    this.unsubscribe()
  }

  private applySnapshot(snapshot: PttHudSnapshot): void {
    const interactive = snapshot.mode === 'recovery'
    this.window.setIgnoreMouseEvents?.(!interactive)

    if (snapshot.mode === 'hidden') {
      if (this.window.isVisible?.() ?? true) {
        this.window.hide()
      }
      return
    }

    if (!(this.window.isVisible?.() ?? false)) {
      if (this.window.showInactive) {
        this.window.showInactive()
      } else {
        this.window.show()
      }
    }
  }
}
