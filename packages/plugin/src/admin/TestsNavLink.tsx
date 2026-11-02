'use client'

import { Link, useConfig } from '@payloadcms/ui'
import { formatAdminURL } from 'payload/shared'
import { usePathname } from 'next/navigation.js'
import { SURFACE_COPY } from './copy/surface.js'

export function TestsNavLink() {
  const { config } = useConfig()
  const path = usePathname()
  const href = formatAdminURL({ adminRoute: config.routes.admin, path: '/experiments' })
  const base = href.replace(/\/$/, '')
  const active = path === base || path?.startsWith(`${base}/`)
  return <Link href={href} className="nav__link" aria-current={active ? 'page' : undefined}>
    {active ? <div className="nav__link-indicator" /> : null}
    <span className="nav__link-label">{SURFACE_COPY.title}</span>
  </Link>
}
