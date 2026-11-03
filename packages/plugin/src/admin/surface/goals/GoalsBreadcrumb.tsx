'use client'
import { Link } from '@payloadcms/ui'
import { formatAdminURL } from 'payload/shared'
import { GOALS_COPY as C } from '../../copy/goals.js'
import { SURFACE_COPY } from '../../copy/surface.js'

export function GoalsBreadcrumb({ adminRoute, name, returnQuery = '' }: { adminRoute: string; name?: string; returnQuery?: string }) {
  return <nav className="xp-goals-breadcrumb" aria-label={C.breadcrumb}>
    <Link href={formatAdminURL({ adminRoute, path: '/experiments' })}>{SURFACE_COPY.title}</Link><span aria-hidden="true">›</span>
    {name ? <><Link href={formatAdminURL({ adminRoute, path: `/experiments/goals${returnQuery}` })}>{C.title}</Link><span aria-hidden="true">›</span><span aria-current="page">{name}</span></>
      : <span aria-current="page">{C.title}</span>}
  </nav>
}
