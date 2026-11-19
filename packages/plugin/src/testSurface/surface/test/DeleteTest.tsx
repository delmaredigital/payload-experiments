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
const VISIBLE_PLACES = 5

/** Matches deleteExperiment's status guard; the server rechecks under its lock. */
export function DeleteTest({ test, canManage, apiRoute, onDeleted }: {
  test: { id: DocId; name: string; status: string }; canManage: boolean; apiRoute: string
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
    setImpact({ state: 'loading' })
    void createApi(apiRoute).deleteImpact(test.id, controller.signal).then(result => {
      if (!current) return
      setImpact(result.ok && result.data && ['none', 'block', 'page'].includes(result.data.effect)
        ? { state: 'ready', data: result.data } : { state: 'failed' })
    })
    return () => { current = false; controller.abort() }
  }, [open, test.id, apiRoute])
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
      {checking ? <p role="status">{C.checking}</p> : impact.state === 'failed' ? <p role="alert">{C.checkFailed}</p> : null}
      {impact.state === 'ready' ? <ImpactDetails impact={impact.data} /> : null}
      {error ? <p role="alert">{error}</p> : null}
      <div className="xp-ui-button-group"><Button data-dialog-cancel disabled={busy} onClick={() => setOpen(false)}>{C.cancel}</Button>
        <Button variant="danger" disabled={checking} aria-disabled={busy || checking || undefined} aria-busy={busy || undefined} onClick={() => void remove()}>{C.action}</Button></div>
    </Dialog>
  </>
}

function ImpactDetails({ impact }: { impact: DeleteImpactResult }) {
  if (impact.effect === 'none') return <p>{C.noEffect}</p>
  const places = impact.effect === 'block' ? impact.placements.map(place =>
    `${place.title}${place.path ? ` (${place.path})` : ''}: ${C.versionChange(place.before.label, place.after.label)}`)
    : impact.addresses.map(path => `${path}: ${C.versionChange(impact.winnerPath, path)}`)
  return <>
    <p>{impact.effect === 'block' ? C.blockWinner : C.pageWinner}</p>
    <ul>{places.slice(0, VISIBLE_PLACES).map((place, index) => <li key={index}>{place}</li>)}</ul>
    {places.length > VISIBLE_PLACES ? <p>{C.morePlaces(places.length - VISIBLE_PLACES)}</p> : null}
  </>
}
