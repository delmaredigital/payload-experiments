'use client'
import { useEffect, useState } from 'react'
import type { ChangeEvent } from 'react'
import { Button } from '../../../ui/Button.js'
import { TextInput } from '../../../ui/Inputs.js'
import { Dialog } from '../../../ui/Dialog.js'
import type { AddMetricBody, MakeContentResult as ContentResult } from '../../../types/endpoints.js'
import type { DocId } from '../../../types/contracts.js'
import type { SectionProps } from '../contracts.js'
import type { ExperimentAction } from '../../actions/actions.model.js'
import { MakeContentResult } from '../../actions/MakeContentResult.js'
import { expectedConfirm, matchesConfirm } from '../../../transitions/confirmPhrases.js'
import { ACTIONS_COPY as A } from '../../copy/actions.js'
import { REVIEW_COPY as R } from '../../copy/review.js'
import { READINESS_COPY as C } from '../../copy/readiness.js'
import { API_MESSAGES, refusalMessage } from '../../copy/common.js'
import { createApi } from '../../api.js'
import { useTransition } from './useTransition.js'

type Props = SectionProps & { onClose(): void }

/** Prop-driven ConfirmDialog adapter: same model/copy, section reload instead of a page reload. */
export function ConfirmAction({ test, surface, action, winnerLabel, onClose }: Props & { action: ExperimentAction; winnerLabel: string }) {
  const api = createApi(surface.apiRoute)
  const [typed, setTyped] = useState('')
  const [content, setContent] = useState<ContentResult | null>(null)
  const transition = useTransition(test, onClose)
  const phrase = action.confirm.phrase ? expectedConfirm(action.confirm.phrase.action, winnerLabel) : null
  const ready = action.id !== 'start' || Boolean(test.preflight && !test.preflightPending && !test.preflightError && test.preflight.checks.every(check => check.ok))
  const enabled = ready && !transition.busy && !test.hasUnsaved && test.saving !== 'saving' && (!phrase || matchesConfirm(phrase, typed))
  async function submit() {
    if (!enabled || !test.doc) return
    const id = test.doc.id
    await transition.run(async () => {
      if (action.archive) return api.archive(id, { ...action.archive, ...(phrase ? { confirmation: typed.trim() } : {}) })
      if (action.id === 'start') return api.start(id)
      if (action.id === 'stop') return api.stop(id)
      if (action.id === 'release-holdout') return api.releaseHoldout(id)
      const result = await api.makeContent(id)
      if (result.ok && result.data) {
        setContent(result.data)
        return result
      }
      return result.ok ? { ok: false, status: 0, retryable: true, message: API_MESSAGES.unreadable } : result
    }, { reloadOnSuccess: action.id !== 'make-content' })
  }
  function close() {
    if (transition.busy) return
    if (content) void test.reload()
    onClose()
  }
  return <Dialog open initialFocus={action.id === 'start' ? undefined : 'cancel'} dismissible={!transition.busy} title={action.confirm.title} onClose={close}>
    {content ? <MakeContentResult result={content} onRetry={submit} busy={transition.busy} /> : <>
      <p>{action.confirm.body}</p>
      {phrase ? <><p>{A.typePhrase} <strong>{phrase}</strong></p>
        <TextInput id="xp-confirmation" label={A.confirmation} value={typed} readOnly={transition.busy} onChange={(event: ChangeEvent<HTMLInputElement>) => setTyped(event.target.value)} />
      </> : null}
    </>}
    {transition.error ? <p role="alert">{transition.error}</p> : null}
    {!content ? <Button disabled={!enabled} onClick={() => { void submit() }}>{action.label}</Button> : null}
    <Button data-dialog-cancel disabled={transition.busy} onClick={close}>{content ? A.done : A.cancel}</Button>
  </Dialog>
}

/** AllocateDialog's validation and copy, with data supplied by the test document. */
export function AllocateAction({ test, surface, onClose }: Props) {
  const current = test.doc?.allocation ?? 100
  const [value, setValue] = useState(String(Math.min(100, current + 1)))
  const transition = useTransition(test, onClose)
  const allocation = Number(value)
  const valid = value.trim() !== '' && Number.isInteger(allocation) && allocation > current && allocation <= 100
  const disabled = transition.busy || test.hasUnsaved || test.saving === 'saving'
  return <Dialog open dismissible={!transition.busy} title={C.allocate} onClose={() => { if (!transition.busy) onClose() }}>
    <p>{R.allocationBody}</p>
    <label>{C.participation}<input type="number" min={current + 1} max={100} step={1} value={value} disabled={disabled}
      onChange={event => setValue(event.target.value)} /></label>
    {!valid ? <p>{R.allocationInvalid}</p> : null}
    {transition.error ? <p role="alert">{transition.error}</p> : null}
    <Button disabled={disabled || !valid} onClick={() => {
      // Not-found can also mean the experiment is missing; use round copy for the missing phase record.
      if (valid && test.doc) void transition.run(() => createApi(surface.apiRoute).allocate(test.doc!.id, { allocation }, { notFound: API_MESSAGES.roundChanged }))
    }}>{C.allocate}</Button>
    <Button disabled={transition.busy} onClick={onClose}>{A.cancel}</Button>
  </Dialog>
}

/** AddMetricDialog adapter; the primary goal is deliberately absent from the role picker. */
export function AddMetricAction({ test, surface, onClose }: Props) {
  const [metrics, setMetrics] = useState<Array<{ id: DocId; name: string }>>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [metric, setMetric] = useState('')
  const [role, setRole] = useState<AddMetricBody['role']>('secondary')
  const transition = useTransition(test, onClose)
  useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      try {
        const response = await fetch(`${surface.apiRoute.replace(/\/$/, '')}/xp-metrics?depth=0&limit=100`, { credentials: 'include', signal: controller.signal })
        if (!response.ok) throw new Error(refusalMessage(undefined, response.status))
        const data = await response.json() as { docs?: Array<{ id: DocId; name: string }> }
        if (!Array.isArray(data.docs)) throw new Error(API_MESSAGES.unreadable)
        if (!controller.signal.aborted) setMetrics(data.docs)
      } catch (cause) {
        if (!controller.signal.aborted) setLoadError(cause instanceof Error ? cause.message : API_MESSAGES.network)
      } finally { if (!controller.signal.aborted) setLoading(false) }
    })()
    return () => controller.abort()
  }, [surface.apiRoute])
  const attached = new Set([test.doc?.metrics?.primary, ...test.doc?.metrics?.secondary ?? [], ...test.doc?.metrics?.guardrails ?? []].filter(id => id != null).map(String))
  const available = metrics.filter(item => !attached.has(String(item.id)))
  const selected = available.find(item => String(item.id) === metric)
  const disabled = transition.busy || test.hasUnsaved || test.saving === 'saving'
  return <Dialog open dismissible={!transition.busy} title={C.addGoal} onClose={() => { if (!transition.busy) onClose() }}>
    <p>{C.addMetric}</p>
    {loading ? <p role="status">{R.loadingMetrics}</p> : null}
    <label>{R.role}<select value={role} disabled={disabled} onChange={event => setRole(event.target.value as AddMetricBody['role'])}>
      <option value="secondary">{R.supporting}</option><option value="guardrail">{R.guardrail}</option>
    </select></label>
    <label>{R.metric}<select value={metric} disabled={disabled || loading} onChange={event => setMetric(event.target.value)}>
      <option value="">{R.chooseMetric}</option>
      {available.map(item => <option key={item.id} value={String(item.id)}>{item.name}</option>)}
    </select></label>
    {!loading && !loadError && !available.length ? <p>{R.noMetrics}</p> : null}
    {loadError || transition.error ? <p role="alert">{loadError ?? transition.error}</p> : null}
    <Button disabled={disabled || loading || !!loadError || !selected} onClick={() => {
      // Goal and phase lookups share not-found; prefer the more likely missing goal without reading server text.
      if (selected && test.doc) void transition.run(() => createApi(surface.apiRoute).addMetric(test.doc!.id, { metric: selected.id, role }, { notFound: API_MESSAGES.goalNotFound }))
    }}>{C.addGoal}</Button>
    <Button disabled={transition.busy} onClick={onClose}>{A.cancel}</Button>
  </Dialog>
}
