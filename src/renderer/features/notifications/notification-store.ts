import type { RuntimeNotification } from '../../../shared/api-types'

export type NotificationEntry = {
  id: string
  level: RuntimeNotification['level']
  message: string
  timestamp: number
}

const INFO_AUTO_DISMISS_MS = 4000

export class NotificationStore {
  private entries: NotificationEntry[] = []
  private cachedToasts: NotificationEntry[] = []
  private cachedBanners: NotificationEntry[] = []
  private timers = new Map<string, ReturnType<typeof setTimeout>>()
  private listeners = new Set<() => void>()
  private nextId = 0

  push(notification: RuntimeNotification): void {
    // Dedupe: if same level + message already exists, skip
    const duplicate = this.entries.find(
      (e) => e.level === notification.level && e.message === notification.message
    )
    if (duplicate) return

    const id = `n-${++this.nextId}`
    const entry: NotificationEntry = {
      id,
      level: notification.level,
      message: notification.message,
      timestamp: Date.now()
    }
    this.entries = [...this.entries, entry]

    if (notification.level === 'info') {
      const timer = setTimeout(() => {
        this.dismiss(id)
      }, INFO_AUTO_DISMISS_MS)
      this.timers.set(id, timer)
    }

    this.updateCaches()
    this.emit()
  }

  dismiss(id: string): void {
    const timer = this.timers.get(id)
    if (timer) {
      clearTimeout(timer)
      this.timers.delete(id)
    }
    this.entries = this.entries.filter((e) => e.id !== id)
    this.updateCaches()
    this.emit()
  }

  getToasts(): NotificationEntry[] {
    return this.cachedToasts
  }

  getBanners(): NotificationEntry[] {
    return this.cachedBanners
  }

  getSnapshot(): NotificationEntry[] {
    return this.entries
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  dispose(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer)
    }
    this.timers.clear()
    this.entries = []
    this.cachedToasts = []
    this.cachedBanners = []
    this.listeners.clear()
  }

  private updateCaches(): void {
    this.cachedToasts = this.entries.filter((e) => e.level === 'info')
    this.cachedBanners = this.entries.filter((e) => e.level !== 'info')
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener()
    }
  }
}
