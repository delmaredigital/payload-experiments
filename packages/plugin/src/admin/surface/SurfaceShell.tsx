'use client'

import '../theme.css'
import type { ReactNode } from 'react'
import { formatAdminURL } from 'payload/shared'
import { Breadcrumb } from '../../ui/Breadcrumb.js'
import { Button } from '../../ui/Button.js'
import { SURFACE_COPY } from '../copy/surface.js'
import './surface.css'

export interface SurfaceShellProps {
  adminRoute: string
  children: ReactNode
  crumbs?: Array<{ label: string; href?: string }>
  title?: string
  status?: ReactNode
  actions?: ReactNode
  subtitle?: ReactNode
}
export function SurfaceShell({ adminRoute, children, crumbs = [{ label: SURFACE_COPY.title }],
  title = SURFACE_COPY.title, status, actions, subtitle }: SurfaceShellProps) {
  return <div className="xp-tests-surface">
    <header className="xp-tests-shell-header">
      <div className="xp-tests-container xp-tests-shell-top">
        <Breadcrumb items={crumbs} />
        <Button variant="quiet" size="sm" href={formatAdminURL({ adminRoute })}>{SURFACE_COPY.backToAdmin}</Button>
      </div>
      <div className="xp-tests-container xp-tests-shell-main">
        <div className="xp-tests-shell-heading"><div className="xp-tests-shell-title"><h1>{title}</h1>{status}</div>
          {subtitle ? <div className="xp-tests-shell-subtitle">{subtitle}</div> : null}</div>
        {actions ? <div className="xp-tests-shell-actions">{actions}</div> : null}
      </div>
    </header>
    <main className="xp-tests-container xp-tests-main">{children}</main>
  </div>
}
