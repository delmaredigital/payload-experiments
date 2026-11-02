'use client'

import { Link, useConfig } from '@payloadcms/ui'
import { usePathname } from 'next/navigation'
import { SURFACE_COPY } from './copy/surface.js'

export function TestsNavLink() {
  const { config } = useConfig()
  const path = usePathname()
  const href = `${config.routes.admin}/experiments`
  const active = path === href || path?.startsWith(`${href}/`)
  return <Link href={href} className={`nav__link${active ? ' nav__link--active' : ''}`} aria-current={active ? 'page' : undefined}>
    {SURFACE_COPY.title}
  </Link>
}
