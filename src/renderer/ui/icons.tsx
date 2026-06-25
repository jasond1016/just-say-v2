import type { LucideProps } from 'lucide-react'
import { Archive, MessageSquare, Mic, Settings } from 'lucide-react'

export const UI_ICON_CLASS = 'ui-icon'

export type AppIconSize = 14 | 16 | 18 | 20

export function appIconProps(size: AppIconSize, className?: string): LucideProps {
  return {
    size,
    strokeWidth: size <= 14 ? 1.75 : 2,
    'aria-hidden': true,
    className: [UI_ICON_CLASS, className].filter(Boolean).join(' ') || undefined,
  }
}

export function NavIcon(props: { name: string }) {
  const iconProps = appIconProps(18)

  switch (props.name) {
    case 'mic':
      return <Mic {...iconProps} />
    case 'session':
      return <MessageSquare {...iconProps} />
    case 'archive':
      return <Archive {...iconProps} />
    case 'settings':
      return <Settings {...iconProps} />
    default:
      return null
  }
}

export function BrandIcon() {
  return <Mic {...appIconProps(20, 'app-sidebar__brand-icon')} />
}
