import { ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'

import { appIconProps } from './icons'

export function RecentHistorySection(props: {
  heading: string
  emptyLabel: string
  viewAllLabel: string
  onViewAll: () => void
  children: ReactNode
  isEmpty: boolean
}) {
  return (
    <section className="page-recent" aria-label={props.heading}>
      <h2 className="page-recent__heading">{props.heading}</h2>
      {props.isEmpty ? (
        <div className="page-recent__empty">{props.emptyLabel}</div>
      ) : (
        <div className="page-recent__list">{props.children}</div>
      )}
      <div className="page-recent__footer">
        <button type="button" className="page-recent__history-link" onClick={props.onViewAll}>
          {props.viewAllLabel}
          <ChevronRight {...appIconProps(14)} />
        </button>
      </div>
    </section>
  )
}

export function formatRecentTime(timestamp: number, t: { speakYesterday: (time: string) => string }): string {
  const date = new Date(timestamp)
  const today = new Date()

  const isToday = date.toDateString() === today.toDateString()
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  const isYesterday = date.toDateString() === yesterday.toDateString()

  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const time = `${hours}:${minutes}`

  if (isToday) {
    return time
  }
  if (isYesterday) {
    return t.speakYesterday(time)
  }
  return `${date.getMonth() + 1}/${date.getDate()} ${time}`
}
