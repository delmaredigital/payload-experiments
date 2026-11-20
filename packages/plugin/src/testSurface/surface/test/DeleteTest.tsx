'use client'
import { useEffect, useRef, useState } from 'react'
import type { DeleteImpactResult } from '../../../types/endpoints.js'
import type { DocId } from '../../../types/contracts.js'
import { createApi } from '../../api.js'
import { DELETE_TEST as C } from '../../copy/testPage.js'
import { Button } from '../../../ui/Button.js'
import { Dialog } from '../../../ui/Dialog.js'

export type DeleteOutcome = 'done' | 'already'
type Impact = { state: 'loading' | 'failed' } | { state: 'ready'; data: DeleteImpactResult }
const VISIBLE_PAGES = 5
export const DELETE_IMPACT_TIMEOUT_MS = 15_000

/** Matches deleteExperiment's status guard; the server rechecks under its lock. */
export function DeleteTest({ test, canManage, apiRoute, contentLocale, onDeleted }: {
  test: { id: DocId; name: string; status: string }; canManage: boolean; apiRoute: string; contentLocale?: string
  onDeleted: (outcome: DeleteOutcome) => void
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const [error, setError] = useState<string>()
  const [impact, setImpact] = useState<Impact>({ state: 'loading' })
  useEffect(() => {
    if (!open) return
    let current = true
    const controller = new AbortController()
    const timer = setTimeout(() => {
      if (!current) return
      current = false; controller.abort(); setImpact({ state: 'failed' })
    }, DELETE_IMPACT_TIMEOUT_MS)
    setImpact({ state: 'loading' })
    void createApi(apiRoute, contentLocale).deleteImpact(test.id, controller.signal).then(result => {
      if (!current) return
      clearTimeout(timer)
      setImpact(result.ok && result.data && ['none', 'block', 'page'].includes(result.data.effect)
        ? { state: 'ready', data: result.data } : { state: 'failed' })
    })
    return () => { current = false; clearTimeout(timer); controller.abort() }
  }, [open, test.id, apiRoute, contentLocale])
  if (!canManage || !['draft', 'archived'].includes(test.status)) return null
  const checking = impact.state === 'loading'
  async function remove() {
    if (checking || pending.current) return
    pending.current = true; setBusy(true); setError(undefined)
    const result = await createApi(apiRoute).deleteTest(test.id)
    if (result.ok || result.status === 404) {
      setOpen(false)
      onDeleted(result.ok ? 'done' : 'already')
    } else setError(result.message)
    pending.current = false; setBusy(false)
  }
  return <>
    <Button variant="quiet" size="sm" onClick={() => { setError(undefined); setImpact({ state: 'loading' }); setOpen(true) }}>{C.action}</Button>
    <Dialog open={open} title={C.title(test.name)} initialFocus="cancel" dismissible={!busy} onClose={() => setOpen(false)}>
      <p>{C.consequences}</p><p>{C.content}</p>
      <p role="status" aria-atomic="true">{checking ? C.checking : impact.state === 'failed' ? C.checkFailed : impact.state === 'ready' ? impactSummary(impact.data) : ''}</p>
      {impact.state === 'ready' ? <ImpactDetails impact={impact.data} /> : null}
      {error ? <p role="alert">{error}</p> : null}
      <div className="xp-ui-button-group"><Button data-dialog-cancel disabled={busy} onClick={() => setOpen(false)}>{C.cancel}</Button>
        <Button variant="danger" disabled={checking} aria-disabled={busy || checking || undefined} aria-busy={busy || undefined} onClick={() => void remove()}>{C.action}</Button></div>
    </Dialog>
  </>
}

function impactSummary(impact: DeleteImpactResult): string {
  return impact.effect === 'none' ? C.noEffect : C.changedPages(impact.effect === 'block' ? impact.pageCount : impact.addresses.length)
}

function ImpactDetails({ impact }: { impact: DeleteImpactResult }) {
  if (impact.effect === 'none') return null
  const places = impact.effect === 'block' ? impact.placements.map(place =>
    `${place.title}${place.path ? ` (${place.path})` : ''}${place.allLocales ? ` · ${C.allLocales}` : place.locales?.length ? ` · ${C.locales(place.locales.join(', '))}` : ''}: ${C.versionChange(place.before.label, place.after.label)}`)
    : impact.addresses.map(path => `${path}: ${C.versionChange(impact.winnerPath, impact.afterPaths?.[path] ?? path)}`)
  return <>
    {places.length ? <><p>{impact.effect === 'block' ? C.blockWinner(impact.controlLabel) : C.pageWinner}</p><p>{C.currentSite}</p></> : null}
    {places.length ? <ul>{places.slice(0, VISIBLE_PAGES).map((place, index) => <li key={index}>{place}</li>)}</ul> : null}
    {places.length > VISIBLE_PAGES ? <p>{C.morePages(places.length - VISIBLE_PAGES)}</p> : null}
    {impact.effect === 'block' && impact.unreadablePages > 0 ? <p>{C.unreadablePages(impact.unreadablePages, impact.pageCount)}</p> : null}
  </>
}
