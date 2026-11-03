'use client'

import './theme.css'
import { Link, NavGroup, useAuth, useConfig } from '@payloadcms/ui'
import { formatAdminURL } from 'payload/shared'
import { usePathname } from 'next/navigation.js'
import { SURFACE_COPY } from './copy/surface.js'

function TestsNav() {
  const { config } = useConfig()
  const { permissions } = useAuth()
  const pathname = usePathname()
  const href = formatAdminURL({ adminRoute: config.routes.admin, path: '/experiments' })
  const goalsHref = formatAdminURL({ adminRoute: config.routes.admin, path: '/experiments/goals' })
  const base = href.replace(/\/$/, '')
  const goalsBase = goalsHref.replace(/\/$/, '')
  const goalsActive = pathname === goalsBase || Boolean(pathname?.startsWith(`${goalsBase}/`))
  const testsActive = !goalsActive && (pathname === base || Boolean(pathname?.startsWith(`${base}/`)))
  const testPermissions: { update?: boolean } | undefined = permissions?.collections?.['xp-experiments']
  const canManage = testPermissions?.update === true
  const entries = [
    { id: 'nav-xp-tests', href, label: SURFACE_COPY.navAllTests, active: testsActive },
    ...(canManage ? [{ id: 'nav-xp-goals', href: goalsHref, label: SURFACE_COPY.navGoals, active: goalsActive }] : []),
  ]
  // getPreference is async and can fetch; let NavGroup default to open.
  return <NavGroup label={SURFACE_COPY.title}>
    {entries.map(entry => {
      const props = { className: 'nav__link', id: entry.id, 'aria-current': entry.active ? 'page' as const : undefined }
      const content = <>
        {entry.active ? <div className="nav__link-indicator" /> : null}
        <span className="nav__link-label">{entry.label}</span>
      </>
      return pathname === entry.href
        ? <div key={entry.id} {...props}>{content}</div>
        : <Link key={entry.id} {...props} href={entry.href} prefetch={false}>{content}</Link>
    })}
  </NavGroup>
}

// Preserve the existing import-map key.
export { TestsNav as TestsNavLink }
