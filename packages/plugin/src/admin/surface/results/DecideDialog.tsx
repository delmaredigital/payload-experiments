'use client'

import { useRef, useState } from 'react'
import { Button, SelectInput, TextareaInput, TextInput } from '@payloadcms/ui'
import type { DocId } from '../../../types/contracts.js'
import type { Snapshot } from '../../../types/snapshot.js'
import type { createApi, ApiResult } from '../../api.js'
import type { ActionGroup } from '../../actions/actions.model.js'
import { DialogFrame } from '../../actions/ConfirmDialog.js'
import { decideState } from '../../actions/decide.model.js'
import { ACTIONS_COPY as C, decideCopy } from '../../copy/actions.js'

/** Surface adapter: the selected round and API are props; no document form. */
export function DecideDialog({ id, api, snapshot, arms, onClose, onSuccess, onRefresh }: {
  id: DocId; api: ReturnType<typeof createApi>; snapshot: Snapshot; arms: readonly ActionGroup[]
  onClose: () => void; onSuccess: () => void; onRefresh: () => void
}) {
  const [chosenArm, setChosenArm] = useState(snapshot.verdict.recommendedArm)
  const [note, setNote] = useState('')
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<Extract<ApiResult<unknown>, { ok: false }> | null>(null)
  const inFlight = useRef(false)
  const state = decideState({ snapshot, arms, chosenArm, note, typed })
  const label = state.options.find(option => option.value === chosenArm)?.label
  async function submit() {
    if (inFlight.current || !state.canSubmit) return
    inFlight.current = true
    setBusy(true)
    setError(null)
    try {
      const result = await api.decide(id, state.body)
      if (result.ok) { onSuccess(); return }
      setError(result)
      if (result.code === 'confirmation-required') {
        setTyped('')
        onRefresh()
      }
    } finally { inFlight.current = false; setBusy(false) }
  }
  return <DialogFrame title={C.decide} onClose={() => { if (!inFlight.current) onClose() }}>
    <SelectInput path="xp-winner" name="xp-winner" label={C.group} options={state.options} value={chosenArm ?? ''}
      readOnly={busy} required onChange={option => {
        setChosenArm(option && !Array.isArray(option) ? String(option.value) : null)
        setTyped('')
      }} />
    {label ? <p>{decideCopy(label, arms.some(group => group.kind === 'holdout' || group.key === 'holdout'), chosenArm === 'control')}</p> : null}
    {state.reason ? <p>{state.reason}</p> : null}
    <TextareaInput path="xp-note" label={C.note} value={note} required={state.guarded} readOnly={busy} onChange={event => setNote(event.target.value)} />
    {state.guarded && label ? <><p>{C.typePhrase} <strong>{state.phrase}</strong></p>
      <TextInput path="xp-decide-confirmation" hasMany={false} label={C.confirmation} value={typed} readOnly={busy} onChange={event => setTyped(event.target.value)} /></> : null}
    {error ? <p role="alert">{error.message}</p> : null}
    <Button disabled={busy || !state.canSubmit} onClick={() => { void submit() }}>{C.decide}</Button>
    <Button disabled={busy} onClick={onClose}>{C.cancel}</Button>
  </DialogFrame>
}
