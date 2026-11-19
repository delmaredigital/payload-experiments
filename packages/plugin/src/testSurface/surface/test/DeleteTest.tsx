'use client'
import { useRef, useState } from 'react'
import type { ContentReport } from '../../../types/endpoints.js'
import type { DocId, ExperimentKind } from '../../../types/contracts.js'
import { createApi } from '../../api.js'
import { DELETE_TEST as C } from '../../copy/testPage.js'
import { Button } from '../../../ui/Button.js'
import { Dialog } from '../../../ui/Dialog.js'

export type DeleteOutcome = 'done' | 'already'

/** Matches deleteExperiment's status guard; the server rechecks under its lock. */
export function DeleteTest({ test, canManage, apiRoute, onDeleted }: {
  test: { id: DocId; name: string; status: string; kind: ExperimentKind; decision?: { winnerArm?: string | null; discardedAt?: string | null; pagesReleasedAt?: string | null; contentReport?: ContentReport | null } | null }; canManage: boolean; apiRoute: string
  onDeleted: (outcome: DeleteOutcome) => void
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const [error, setError] = useState<string>()
  if (!canManage || !['draft', 'archived'].includes(test.status)) return null
  const standingWinner = test.status === 'archived' && test.decision?.winnerArm && !test.decision.discardedAt
  const report = test.decision?.contentReport
  const docs = Array.isArray(report) ? report : report?.docs ?? []
  const remaining = standingWinner && test.kind === 'block' && test.decision?.winnerArm !== 'control'
    ? docs.filter(doc => doc.dismissedAt || !doc.ok) : []
  const warning = remaining.length ? C.blockWinner : standingWinner && test.kind === 'page' && !test.decision?.pagesReleasedAt ? C.pageWinner : undefined
  async function remove() {
    if (pending.current) return
    pending.current = true; setBusy(true); setError(undefined)
    const result = await createApi(apiRoute).deleteTest(test.id)
    if (result.ok || result.status === 404) {
      setOpen(false)
      onDeleted(result.ok ? 'done' : 'already')
    } else setError(result.message)
    pending.current = false; setBusy(false)
  }
  return <>
    <Button variant="quiet" size="sm" onClick={() => { setError(undefined); setOpen(true) }}>{C.action}</Button>
    <Dialog open={open} title={C.title(test.name)} initialFocus="cancel" dismissible={!busy} onClose={() => setOpen(false)}>
      <p>{C.consequences}</p><p>{C.content}</p>{warning ? <p>{warning}</p> : null}
      {remaining.length ? <ul>{remaining.map(doc => {
        const title = 'title' in doc && typeof doc.title === 'string' ? doc.title : ''
        const path = 'path' in doc && typeof doc.path === 'string' ? doc.path : ''
        return <li key={`${doc.collection}/${doc.id}`}>{title && path ? `${title} (${path})` : title || path || `${doc.collection}/${doc.id}`}</li>
      })}</ul> : null}
      {error ? <p role="alert">{error}</p> : null}
      <div className="xp-ui-button-group"><Button data-dialog-cancel disabled={busy} onClick={() => setOpen(false)}>{C.cancel}</Button>
        <Button variant="danger" aria-disabled={busy || undefined} aria-busy={busy || undefined} onClick={() => void remove()}>{C.action}</Button></div>
    </Dialog>
  </>
}
