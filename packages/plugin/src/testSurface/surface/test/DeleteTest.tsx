'use client'
import { useRef, useState } from 'react'
import type { DocId } from '../../../types/contracts.js'
import { createApi } from '../../api.js'
import { API_MESSAGES } from '../../copy/common.js'
import { DELETE_TEST as C } from '../../copy/testPage.js'
import { Button } from '../../../ui/Button.js'
import { Dialog } from '../../../ui/Dialog.js'

/** Matches deleteExperiment's status guard; the server rechecks under its lock. */
export function DeleteTest({ test, canManage, apiRoute, onDeleted }: {
  test: { id: DocId; name: string; status: string }; canManage: boolean; apiRoute: string
  onDeleted: (message: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const [error, setError] = useState<string>()
  if (!canManage || !['draft', 'archived'].includes(test.status)) return null
  async function remove() {
    if (pending.current) return
    pending.current = true; setBusy(true); setError(undefined)
    const result = await createApi(apiRoute).deleteTest(test.id)
    if (result.ok || result.status === 404) {
      setOpen(false)
      onDeleted(result.ok ? C.deleted : API_MESSAGES.testAlreadyDeleted)
    } else setError(result.message)
    pending.current = false; setBusy(false)
  }
  return <>
    <Button variant="quiet" size="sm" onClick={() => { setError(undefined); setOpen(true) }}>{C.action}</Button>
    <Dialog open={open} title={C.title(test.name)} initialFocus="cancel" dismissible={!busy} onClose={() => setOpen(false)}>
      <p>{C.consequences}</p><p>{C.content}</p>
      {error ? <p role="alert">{error}</p> : null}
      <div className="xp-ui-button-group"><Button data-dialog-cancel disabled={busy} onClick={() => setOpen(false)}>{C.cancel}</Button>
        <Button variant="danger" busy={busy} onClick={() => void remove()}>{C.action}</Button></div>
    </Dialog>
  </>
}
