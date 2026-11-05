'use client'
import { useEffect, useRef, useState } from 'react'
import { fetchAllDocs } from '../../lib/fetchAllDocs.js'
import { CLICK_KEY } from '../key.js'
import { clickGoalBody, clickGoalCreateError, clickGoalSlug, definedClickGoals, undefinedClickKey, type ClickGoal, type PickerStatus } from './clickGoalPicker.model.js'

const emptyPanel = () => ({ open: false, name: '', slug: '', slugEdited: false, advanced: false, pending: false,
  errors: {} as { slug?: string; general?: string } })

/** UI-free state shared by the two editor hosts. A refused read silently removes management. */
export function useClickGoalPicker(apiRoute: string, { enabled = true, onSelect }: { enabled?: boolean; onSelect: (slug: string) => void }) {
  const api = apiRoute.replace(/\/$/, '')
  const [loaded, setLoaded] = useState<{ api: string; status: PickerStatus; goals: ClickGoal[] }>({ api, status: 'loading', goals: [] })
  const [panel, setPanel] = useState(emptyPanel)
  const flight = useRef(false)
  const binding = useRef({ api, enabled, live: true, onSelect })
  binding.current.api = api; binding.current.enabled = enabled; binding.current.onSelect = onSelect
  useEffect(() => { binding.current.live = true; return () => { binding.current.live = false } }, [])
  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    setLoaded({ api, status: 'loading', goals: [] }); setPanel(emptyPanel())
    void (async () => {
      try {
        const result = await fetchAllDocs<ClickGoal>(`${api}/xp-metrics?where[source][like]=click:&depth=0`, { credentials: 'include', signal: controller.signal })
        if (controller.signal.aborted) return
        setLoaded(result.ok ? { api, status: 'ready', goals: definedClickGoals(result.docs) }
          : { api, status: result.status === 403 ? 'not-manager' : 'error', goals: [] })
      } catch { if (!controller.signal.aborted) setLoaded({ api, status: 'error', goals: [] }) }
    })()
    return () => controller.abort()
  }, [api, enabled])
  const status = !enabled ? 'not-manager' : loaded.api === api ? loaded.status : 'loading'
  const goals = status === 'ready' ? loaded.goals : []
  const canManage = status === 'ready'
  async function create() {
    if (!canManage || !panel.open || flight.current || !panel.name.trim()) return
    if (!CLICK_KEY.test(panel.slug)) {
      setPanel(current => ({ ...current, advanced: true, errors: clickGoalCreateError(panel.slug) })); return
    }
    flight.current = true; setPanel(current => ({ ...current, pending: true, errors: {} }))
    const current = () => binding.current.live && binding.current.enabled && binding.current.api === api
    try {
      const response = await fetch(`${api}/xp-metrics`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(clickGoalBody(panel.name, panel.slug)) })
      const body: unknown = await response.json().catch(() => undefined)
      if (!current()) return
      if (!response.ok) {
        if (response.status === 403) { setLoaded({ api, status: 'not-manager', goals: [] }); setPanel(emptyPanel()); return }
        const errors = clickGoalCreateError(panel.slug, body)
        setPanel(value => ({ ...value, pending: false, advanced: value.advanced || Boolean(errors.slug), errors })); return
      }
      const doc = (body as { doc?: ClickGoal } | undefined)?.doc
      if (!doc || typeof doc.slug !== 'string' || typeof doc.name !== 'string' || !isFiniteId(doc.id)) throw new Error('response')
      setLoaded(value => ({ ...value, goals: [...value.goals.filter(goal => goal.id !== doc.id), doc] }))
      binding.current.onSelect(doc.slug); setPanel(emptyPanel())
    } catch { if (current()) setPanel(value => ({ ...value, pending: false, errors: clickGoalCreateError(panel.slug) })) }
    finally { flight.current = false }
  }
  return { status, goals, canManage, undefinedKey: (value: string) => undefinedClickKey(status, goals, value), panel,
    open: () => { if (canManage) setPanel({ ...emptyPanel(), open: true }) },
    cancel: () => { if (!flight.current) setPanel(emptyPanel()) },
    setName: (name: string) => setPanel(value => {
      const slug = value.slugEdited ? value.slug : clickGoalSlug(name)
      const invalid = !value.slugEdited && !CLICK_KEY.test(slug)
      return { ...value, name, slug, advanced: value.advanced || invalid, errors: invalid ? clickGoalCreateError(slug) : {} }
    }),
    setSlug: (slug: string) => setPanel(value => ({ ...value, slug, slugEdited: true, errors: {} })),
    setAdvanced: (advanced: boolean) => setPanel(value => ({ ...value, advanced })), create }
}
function isFiniteId(id: unknown): id is string | number { return typeof id === 'string' || typeof id === 'number' && Number.isFinite(id) }
export type ClickGoalPicker = ReturnType<typeof useClickGoalPicker>
