import { forwardRef, type ChangeEvent, type ReactNode } from 'react'

type ButtonVariant = 'primary' | 'secondary' | 'ghost'

export function Button(props: {
  label: string
  variant?: ButtonVariant
  size?: 'default' | 'small'
  disabled?: boolean | undefined
  danger?: boolean | undefined
  className?: string | undefined
  ariaLabel?: string | undefined
  ariaControls?: string | undefined
  ariaExpanded?: boolean | undefined
  ariaPressed?: boolean | undefined
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
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      className={className}
      aria-label={props.ariaLabel}
      aria-controls={props.ariaControls}
      aria-expanded={props.ariaExpanded}
      aria-pressed={props.ariaPressed}
    >
      {props.label}
    </button>
  )
}

export const TextInput = forwardRef<HTMLInputElement, {
  id?: string | undefined
  ariaLabel?: string | undefined
  ariaDescribedBy?: string | undefined
  value: string
  disabled?: boolean | undefined
  placeholder?: string | undefined
  inputMode?: 'text' | 'numeric' | undefined
  className?: string | undefined
  onChange: (e: ChangeEvent<HTMLInputElement>) => void
}>((props, ref) => {
  return (
    <input
      ref={ref}
      id={props.id}
      aria-label={props.ariaLabel}
      aria-describedby={props.ariaDescribedBy}
      value={props.value}
      disabled={props.disabled}
      placeholder={props.placeholder}
      inputMode={props.inputMode}
      onChange={props.onChange}
      className={['field-input', props.className ?? ''].filter(Boolean).join(' ')}
    />
  )
})
TextInput.displayName = 'TextInput'

export function SelectField(props: {
  id?: string | undefined
  ariaLabel?: string | undefined
  ariaDescribedBy?: string | undefined
  value: string
  disabled?: boolean | undefined
  className?: string | undefined
  onChange: (e: ChangeEvent<HTMLSelectElement>) => void
  children: ReactNode
}) {
  return (
    <select
      id={props.id}
      aria-label={props.ariaLabel}
      aria-describedby={props.ariaDescribedBy}
      value={props.value}
      disabled={props.disabled}
      onChange={props.onChange}
      className={['field-select', props.className ?? ''].filter(Boolean).join(' ')}
    >
      {props.children}
    </select>
  )
}
