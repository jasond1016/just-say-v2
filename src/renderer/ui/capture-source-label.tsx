import { Mic, Monitor } from 'lucide-react'

import type { CaptureSource } from '../../shared/primitive-types'
import { useT } from '../i18n-context'
import { describeCaptureSource, describeCaptureSourceShort } from './copy'
import { appIconProps } from './icons'

export function CaptureSourceLabel(props: { source: CaptureSource }) {
  const t = useT()

  return (
    <div
      className="capture-source-label"
      title={describeCaptureSource(props.source, t)}
    >
      {props.source === 'microphone' ? (
        <Mic {...appIconProps(14, 'capture-source-label__icon')} />
      ) : (
        <Monitor {...appIconProps(14, 'capture-source-label__icon')} />
      )}
      <span>{describeCaptureSourceShort(props.source, t)}</span>
    </div>
  )
}
