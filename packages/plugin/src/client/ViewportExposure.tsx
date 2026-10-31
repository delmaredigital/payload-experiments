'use client'

import { useContext, useEffect, useRef } from 'react'
import type * as React from 'react'
import { sendExposure, warnOnce } from './beacon.js'
import { ExperimentsContext } from './context.js'

export function ViewportExposure({ expose, children }: { expose?: { slug: string; arm: string; phase: number }; children: React.ReactNode }): React.JSX.Element {
  const value = useContext(ExperimentsContext)
  const sentinel = useRef<HTMLDivElement>(null)
  const apiRoute = value?.apiRoute
  const slug = expose?.slug, arm = expose?.arm, phase = expose?.phase
  useEffect(() => {
    if (slug === undefined || arm === undefined || phase === undefined) return
    if (apiRoute === undefined) {
      warnOnce('viewport:no-provider', 'ViewportExposure requires ExperimentsProvider to send an exposure.')
      return
    }
    const target = sentinel.current
    if (!target || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.target === target && entry.intersectionRatio >= 0.5)) return
      sendExposure(apiRoute, { type: 'exposure', experiment: slug, phase, arm, policy: 'viewport' })
      observer.disconnect()
    }, { threshold: 0.5 })
    observer.observe(target)
    return () => observer.disconnect()
  }, [slug, arm, phase, apiRoute])
  // Nothing to expose (no running experiment, or a render-policy slot): render exactly
  // what experiments-off renders — no wrapper, no sentinel (owner rule O9). Hooks stay above.
  if (expose === undefined) return <>{children}</>
  return <div data-xp-viewport style={{ position: 'relative', display: 'block' }}>
    <div ref={sentinel} data-xp-sentinel aria-hidden style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100px', pointerEvents: 'none', visibility: 'hidden' }} />
    {children}
  </div>
}
