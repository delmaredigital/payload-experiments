'use client'

import { useRef, useState } from 'react'
import { Button } from '@payloadcms/ui'
import type { DocId } from '../../types/contracts.js'
import type { AllocateBody } from '../../types/endpoints.js'
import { DialogFrame } from './ConfirmDialog.js'
import { useApi } from '../useApi.js'
import { reloadPage } from '../reload.js'
import { REVIEW_COPY as C, REVIEW_HINTS } from '../copy/review.js'
import { ACTIONS_COPY } from '../copy/actions.js'

export function AllocateDialog({ id, allocation: current, onClose }: { id: DocId; allocation: number; onClose: () => void }) {
  const api = useApi()
  const [value, setValue] = useState(String(Math.min(100, current + 1)))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inFlight = useRef(false)
  const allocation = Number(value)
  const valid = value.trim() !== '' && Number.isInteger(allocation) && allocation > current && allocation <= 100
  async function submit() {
    if (inFlight.current || !valid) return
    inFlight.current = true
    setBusy(true)
    setError(null)
    const body: AllocateBody = { allocation }
    const result = await api.allocate(id, body)
    if (result.ok) { reloadPage(); return }
    setError(result.code === 'allocation-lower' ? REVIEW_HINTS['allocation-lower'] : result.message)
    inFlight.current = false
    setBusy(false)
  }
  return <DialogFrame title={C.raise} onClose={() => { if (!inFlight.current) onClose() }}>
    <p>{C.allocationBody}</p>
    <label>{C.allocation}<input type="number" min={current + 1} max={100} step={1} value={value} disabled={busy}
      onChange={event => setValue(event.target.value)} /></label>
    {!valid ? <p>{C.allocationInvalid}</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    <Button disabled={busy || !valid} onClick={() => { void submit() }}>{C.raise}</Button>
    <Button disabled={busy} onClick={() => { if (!inFlight.current) onClose() }}>{ACTIONS_COPY.cancel}</Button>
  </DialogFrame>
}
