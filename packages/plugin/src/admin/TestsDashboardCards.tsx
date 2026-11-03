'use client'

import './theme.css'
import './dashboard.css'
import { Card, useAuth, useConfig } from '@payloadcms/ui'
import { formatAdminURL } from 'payload/shared'
import { SURFACE_COPY } from './copy/surface.js'

export function TestsDashboardCards() {
  const { config } = useConfig()
  const { permissions } = useAuth()
  const testPermissions: { update?: boolean } | undefined = permissions?.collections?.['xp-experiments']
  const canManage = testPermissions?.update === true
  if (!canManage) return null
  const href = (path: `/${string}`) => formatAdminURL({ adminRoute: config.routes.admin, path })
  return <section className="xp-dash-group" aria-labelledby="xp-dash-title">
    <h2 className="xp-dash-label" id="xp-dash-title">{SURFACE_COPY.title}</h2>
    <ul className="xp-dash-card-list">
      <li><Card title={SURFACE_COPY.navAllTests} titleAs="h3" buttonAriaLabel={SURFACE_COPY.dashShowTests} href={href('/experiments')} id="card-xp-tests" /></li>
      <li><Card title={SURFACE_COPY.navGoals} titleAs="h3" buttonAriaLabel={SURFACE_COPY.dashShowGoals} href={href('/experiments/goals')} id="card-xp-goals" /></li>
    </ul>
  </section>
}
