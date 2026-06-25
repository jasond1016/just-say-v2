import { Pencil } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { appIconProps } from './icons'

export function EditableInlineTitle(props: {
  title: string
  ariaLabel: string
  disabled?: boolean
  canEdit?: boolean
  titleClassName?: string
  inputClassName?: string
  editButtonClassName?: string
  onRename: (title: string) => void | Promise<void>
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [draft, setDraft] = useState(props.title)
  const canEdit = props.canEdit !== false

  useEffect(() => {
    setDraft(props.title)
    setIsEditing(false)
  }, [props.title])

  useEffect(() => {
    if (!isEditing) {
      return
    }

    inputRef.current?.focus()
    inputRef.current?.select()
  }, [isEditing])

  const cancelEditing = () => {
    setDraft(props.title)
    setIsEditing(false)
  }

  const commitEditing = () => {
    const nextTitle = draft.trim()

    if (!nextTitle || nextTitle === props.title) {
      cancelEditing()
      return
    }

    void Promise.resolve(props.onRename(nextTitle)).finally(() => {
      setIsEditing(false)
    })
  }

  const startEditing = () => {
    if (props.disabled || !canEdit) {
      return
    }

    setDraft(props.title)
    setIsEditing(true)
  }

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        type="text"
        className={props.inputClassName}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            commitEditing()
          }

          if (event.key === 'Escape') {
            event.preventDefault()
            cancelEditing()
          }
        }}
        onBlur={commitEditing}
        maxLength={120}
        aria-label={props.ariaLabel}
      />
    )
  }

  return (
    <>
      <span className={props.titleClassName}>{props.title}</span>
      {canEdit ? (
        <button
          type="button"
          className={props.editButtonClassName}
          aria-label={props.ariaLabel}
          disabled={props.disabled}
          onClick={startEditing}
        >
          <Pencil {...appIconProps(16)} />
        </button>
      ) : null}
    </>
  )
}
