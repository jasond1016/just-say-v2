import { useSyncExternalStore } from 'react'

import type { NotificationEntry, NotificationStore } from './notification-store'

export function ToastContainer(props: { store: NotificationStore }) {
  const toasts = useSyncExternalStore(
    (cb) => props.store.subscribe(cb),
    () => props.store.getToasts()
  )

  if (toasts.length === 0) return null

  return (
    <div className="toast-container" aria-live="polite" role="status">
      {toasts.map((toast) => (
        <div key={toast.id} className="toast toast--info">
          <span className="toast__message">{toast.message}</span>
          <button
            type="button"
            className="toast__dismiss"
            aria-label="Dismiss"
            onClick={() => props.store.dismiss(toast.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  )
}

export function BannerContainer(props: { store: NotificationStore }) {
  const banners = useSyncExternalStore(
    (cb) => props.store.subscribe(cb),
    () => props.store.getBanners()
  )

  if (banners.length === 0) return null

  return (
    <div className="banner-container">
      {banners.map((banner) => (
        <BannerItem key={banner.id} entry={banner} onDismiss={() => props.store.dismiss(banner.id)} />
      ))}
    </div>
  )
}

function BannerItem(props: { entry: NotificationEntry; onDismiss: () => void }) {
  const { entry, onDismiss } = props
  return (
    <div
      className={`app-note app-note--${entry.level}`}
      role={entry.level === 'error' ? 'alert' : 'status'}
      aria-live={entry.level === 'error' ? 'assertive' : 'polite'}
    >
      <div className="app-note__content">
        <strong>{entry.level === 'error' ? 'Action needed' : 'Warning'}</strong>
        <span>{entry.message}</span>
      </div>
      <button
        type="button"
        className="app-note__dismiss"
        aria-label="Dismiss"
        onClick={onDismiss}
      >
        ×
      </button>
    </div>
  )
}
