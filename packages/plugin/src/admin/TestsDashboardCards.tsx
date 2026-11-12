'use client'

import { surfaceUrls } from '../testSurface/surfaceUrls.js'
import './theme.css'
import './dashboard.css'
import { Card, useAuth, useConfig } from '@payloadcms/ui'
import { SURFACE_COPY } from '../testSurface/copy/surface.js'

/** @deprecated Retained for existing import maps until 0.5.0. */
export function TestsDashboardCards() {
  const { config } = useConfig()
  const { permissions } = useAuth()
  const testPermissions: { update?: boolean } | undefined = permissions?.collections?.['xp-experiments']
  const canManage = testPermissions?.update === true
  if (!canManage) return null
  return <section className="xp-dash-group" aria-labelledby="xp-dash-title">
    <h2 className="xp-dash-label" id="xp-dash-title">{SURFACE_COPY.title}</h2>
    <ul className="xp-dash-card-list">
      <li><Card title={SURFACE_COPY.navAllTests} titleAs="h3" buttonAriaLabel={SURFACE_COPY.dashShowTests} href={surfaceUrls.home(config.routes.admin)} id="card-xp-tests" /></li>
      <li><Card title={SURFACE_COPY.navGoals} titleAs="h3" buttonAriaLabel={SURFACE_COPY.dashShowGoals} href={surfaceUrls.goals(config.routes.admin)} id="card-xp-goals" /></li>
    </ul>
  </section>
}
