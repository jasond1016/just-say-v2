import type { ChangeEvent, ReactNode } from 'react'

type ButtonVariant = 'primary' | 'secondary' | 'ghost'

export function Button(props: {
  label: string
  variant?: ButtonVariant
  size?: 'default' | 'small'
  disabled?: boolean | undefined
  danger?: boolean | undefined
  className?: string | undefined
  onClick: () => void
}) {
  const variant = props.variant ?? 'secondary'
  const size = props.size ?? 'default'
  const className = [
    'button',
    `button--${variant}`,
    size === 'small' ? 'button--small' : '',
    props.danger ? 'button--danger' : '',
    props.className ?? ''
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <button type="button" onClick={props.onClick} disabled={props.disabled} className={className}>
      {props.label}
    </button>
  )
}

export function TextInput(props: {
  value: string
  disabled?: boolean | undefined
  placeholder?: string | undefined
  inputMode?: 'text' | 'numeric' | undefined
  className?: string | undefined
  onChange: (e: ChangeEvent<HTMLInputElement>) => void
}) {
  return (
    <input
      value={props.value}
      disabled={props.disabled}
      placeholder={props.placeholder}
      inputMode={props.inputMode}
      onChange={props.onChange}
      className={['field-input', props.className ?? ''].filter(Boolean).join(' ')}
    />
  )
}

export function SelectField(props: {
  value: string
  disabled?: boolean | undefined
  className?: string | undefined
  onChange: (e: ChangeEvent<HTMLSelectElement>) => void
  children: ReactNode
}) {
  return (
    <select
      value={props.value}
      disabled={props.disabled}
      onChange={props.onChange}
      className={['field-select', props.className ?? ''].filter(Boolean).join(' ')}
    >
      {props.children}
    </select>
  )
}
