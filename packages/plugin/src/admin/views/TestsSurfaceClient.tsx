'use client'
import { useLocale } from '@payloadcms/ui'
import { TestsSurface as Surface } from '../surface/TestsSurface.js'
import type { TestsSurfaceProps } from '../../types/surface.js'

/** Payload context stays at the admin entry; the mountable surface stays neutral. */
export function TestsSurface(props: TestsSurfaceProps) {
  const locale = useLocale()
  return <Surface {...props} contentLocale={locale?.code} />
}
