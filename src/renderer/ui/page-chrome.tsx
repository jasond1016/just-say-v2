import type { ReactNode, RefObject } from 'react'

export function PageChrome(props: {
  title: string
  subtitle?: string
  belowTitle?: ReactNode
  actions?: ReactNode
  titleRef?: RefObject<HTMLHeadingElement | null>
  titleId?: string
}) {
  return (
    <header className="page-chrome">
      <div className="page-chrome__main">
        <h1 className="page-title" id={props.titleId} ref={props.titleRef} tabIndex={props.titleRef ? -1 : undefined}>
          {props.title}
        </h1>
        {props.subtitle ? <p className="page-chrome__subtitle">{props.subtitle}</p> : null}
        {props.belowTitle}
      </div>
      {props.actions ? <div className="page-chrome__actions">{props.actions}</div> : null}
    </header>
  )
}
