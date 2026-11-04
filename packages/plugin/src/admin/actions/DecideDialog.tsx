'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '../../ui/Button.js'
import { Select, Textarea, TextInput } from '../../ui/Inputs.js'
import type { DocId } from '../../types/contracts.js'
import type { ResultsResponse } from '../../types/endpoints.js'
import type { ApiResult } from '../api.js'
import { useApi } from '../useApi.js'
import { reloadPage } from '../reload.js'
import { RESULTS_COPY } from '../copy/results.js'
import { ACTIONS_COPY as C, decideCopy } from '../copy/actions.js'
import type { ActionGroup } from './actions.model.js'
import { decideState } from './decide.model.js'
import { DialogFrame } from './ConfirmDialog.js'

export function DecideDialog({ id, arms, onClose }: { id: DocId; arms: readonly ActionGroup[]; onClose: () => void }) {
  const api = useApi()
  const [snapshot, setSnapshot] = useState<ResultsResponse['snapshot']>(null)
  const [chosenArm, setChosenArm] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [typed, setTyped] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  const refreshing = useRef(false)
  const [error, setError] = useState<Extract<ApiResult<unknown>, { ok: false }> | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const state = decideState({ snapshot, arms, chosenArm, note, typed })
  useEffect(() => {
    let current = true
    void api.results(id).then(result => {
      if (!current) return
      if (result.ok) {
        const next = result.data?.snapshot ?? null
        setSnapshot(next)
        setChosenArm(next?.verdict.recommendedArm ?? null)
      } else { setError(result); setLoadFailed(true) }
      setLoading(false)
    })
    return () => { current = false }
  }, [api, id])

  async function refresh() {
    if (refreshing.current) return
    refreshing.current = true
    setLoading(true)
    const result = await api.results(id)
    refreshing.current = false
    setLoading(false)
    if (result.ok) { setSnapshot(result.data?.snapshot ?? null); setLoadFailed(false) }
    else { setSnapshot(null); setError(result); setLoadFailed(true) }
  }
  async function submit() {
    if (inFlight.current || loading || busy || !state.canSubmit || loadFailed) return
    inFlight.current = true
    setBusy(true)
    setError(null)
    const result = await api.decide(id, state.body)
    if (result.ok) { reloadPage(); return }
    else {
      setError(result)
      if (result.code === 'confirmation-required') { setTyped(''); await refresh() }
    }
    inFlight.current = false
    setBusy(false)
  }
  const enabled = !busy && !loading && !loadFailed && state.canSubmit
  const label = state.options.find(option => option.value === chosenArm)?.label
  return <DialogFrame dismissible={!busy} initialFocus="cancel" title={C.decide} onClose={() => { if (!busy) onClose() }}>
    {loading ? <p role="status">{C.loading}</p> : null}
    <Select id="xp-winner" name="xp-winner" label={C.group} value={chosenArm ?? ''}
      disabled={busy || loading} required onChange={event => {
        setChosenArm(event.target.value || null)
        setTyped('')
      }}><option value="">{RESULTS_COPY.chooseGroup}</option>{state.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</Select>
    {label ? <p>{decideCopy(label, arms.some(group => group.key === 'holdout'), chosenArm === 'control')}</p> : null}
    {state.reason ? <p>{state.reason}</p> : null}
    <Textarea id="xp-note" label={C.note} value={note} required={state.guarded} readOnly={busy}
      onChange={event => setNote(event.target.value)} />
    {state.guarded && label ? <><p>{C.typePhrase} <strong>{state.phrase}</strong></p>
      <TextInput id="xp-decide-confirmation" label={C.confirmation} value={typed} readOnly={busy}
        onChange={event => setTyped(event.target.value)} /></> : null}
    {error ? <p role="alert">{error.message}</p> : null}
    <Button disabled={!enabled} onClick={() => { void submit() }}>{C.decide}</Button>
    {error?.retryable ? <Button disabled={busy || loading || (!loadFailed && !state.canSubmit)}
      onClick={() => { if (loadFailed) { setError(null); void refresh() } else void submit() }}>{C.retry}</Button> : null}
    <Button data-dialog-cancel disabled={busy} onClick={onClose}>{C.cancel}</Button>
  </DialogFrame>
}
