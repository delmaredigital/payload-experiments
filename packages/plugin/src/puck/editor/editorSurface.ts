'use client'

import { useCallback, useEffect, useState } from 'react'
import type { SurfaceProps } from '../../testSurface/surface/contracts.js'

// Only pending requests are shared. Settled permissions never survive a drawer session.
export type SurfaceState = { surface?: SurfaceProps; error?: 'forbidden' | 'unavailable' }
const pending = new Map<string, Promise<SurfaceState>>()
export function readSurface(api: string): Promise<SurfaceState> {
  let request = pending.get(api)
  if (!request) {
    request = fetch(`${api}/xp/editor-surface`, { credentials: 'include', cache: 'no-store' }).then(async response => {
      if (response.status === 401 || response.status === 403) return { error: 'forbidden' as const }
      if (!response.ok) throw new Error('surface')
      const surface = await response.json() as SurfaceProps
      if (!surface || typeof surface.canManage !== 'boolean' || typeof surface.canReadResults !== 'boolean') throw new Error('surface')
      return { surface }
    }).catch(() => ({ error: 'unavailable' as const }))
    pending.set(api, request)
    const release = () => { if (pending.get(api) === request) pending.delete(api) }
    void request.then(release, release)
  }
  return request
}

/** Share only pending requests across canvas blocks and sidebar controls. */
export function useEditorSurface(api: string): SurfaceState & { retry: () => void } {
  const [loaded, setLoaded] = useState<{ api: string; state: SurfaceState }>()
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => { setLoaded(undefined); setAttempt(value => value + 1) }, [])
  useEffect(() => {
    let active = true
    const load = () => { void readSurface(api).then(state => { if (active) setLoaded({ api, state }) }) }
    load()
    const onVisible = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { active = false; document.removeEventListener('visibilitychange', onVisible) }
  }, [api, attempt])
  return { ...(loaded?.api === api ? loaded.state : {}), retry }
}
