'use client'

import type { ReactNode } from 'react'
import { Link } from '@payloadcms/ui'
import { SURFACE_COPY } from '../copy/surface.js'
import './surface.css'

export function SurfaceShell({ adminRoute, children }: { adminRoute: string; children: ReactNode }) {
  return <div className="xp-tests-surface">
    <header className="xp-tests-shell-header"><Link href={`${adminRoute}/experiments`}>{SURFACE_COPY.title}</Link></header>
    <main className="xp-tests-main">{children}</main>
  </div>
}
