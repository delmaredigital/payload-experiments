'use client'
import { useEffect, useRef, useState } from 'react'
import { Button, useConfig, useDocumentInfo, useForm, useFormFields, useFormModified } from '@payloadcms/ui'
import type { UIFieldClientProps } from 'payload'
import type { ExperimentKind, MetricSource, Status } from '../../types/contracts.js'
import type { PreflightResult } from '../../types/endpoints.js'
import type { SerializedMetricSource } from '../../types/admin.js'
import { useApi } from '../useApi.js'
import { reloadPage } from '../reload.js'
import { readArms } from '../arms/arms.model.js'
import { PreviewLinks } from '../PreviewLinks.js'
import { REVIEW_COPY as C } from '../copy/review.js'
import { API_MESSAGES, LOCKED_MESSAGES } from '../copy/common.js'
import { availableActions } from '../actions/actions.model.js'
import { ConfirmDialog } from '../actions/ConfirmDialog.js'
import { reviewView } from './review.model.js'

export function ReviewPanel(_props: UIFieldClientProps) {
  const { id, data } = useDocumentInfo()
  const savedAt = typeof data?.updatedAt === 'string' ? data.updatedAt : undefined
  const { config, getEntityConfig } = useConfig()
  const api = useApi()
  const { dispatchFields, setModified } = useForm()
  const modified = useFormModified()
  const status = useFormFields(([fields]) => (fields.status?.value ?? 'draft') as Status)
  const kind = useFormFields(([fields]) => (fields.kind?.value ?? 'block') as ExperimentKind)
  const armsJson = useFormFields(([fields]) => JSON.stringify(readArms(fields)))
  const arms = JSON.parse(armsJson) as ReturnType<typeof readArms>
  const metricFields = getEntityConfig({ collectionSlug: 'xp-metrics' })?.fields as
    Array<{ name?: string; admin?: { custom?: { sources?: SerializedMetricSource[] } } }> | undefined
  const sourcesJson = JSON.stringify(metricFields?.find(field => field.name === 'source')?.admin?.custom?.sources ?? [])
  const [preflight, setPreflight] = useState<PreflightResult | null>(null)
  const [refresh, setRefresh] = useState(0)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [confirmStart, setConfirmStart] = useState(false)
  const inFlight = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [metricKind, setMetricKind] = useState<MetricSource['kind']>()
  const [duration, setDuration] = useState('')
  const [tuning, setTuning] = useState('')
  useEffect(() => {
    if (id == null) return
    let active = true
    setLoading(true)
    setError(null)
    void api.preflight(id).then(result => {
      if (!active) return
      if (result.ok && result.data) {
        setPreflight(result.data)
        setDuration(result.data.estimate ? String(result.data.estimate.plannedDurationDays) : '')
        setTuning(result.data.estimate ? String(result.data.estimate.sequentialTuningParameter) : '')
      } else { setPreflight(null); setError(result.ok ? API_MESSAGES.unreadable : result.message) }
      setLoading(false)
    })
    return () => { active = false }
  }, [id, api, refresh, savedAt])
  // The preflight wire shape contains the value, but the saved metric's source supplies its kind.
  const metricId = preflight?.baseline?.metricId
  useEffect(() => {
    setMetricKind(undefined)
    if (metricId == null) return
    const controller = new AbortController()
    void (async () => {
      try {
        const response = await fetch(`${config.routes.api.replace(/\/$/, '')}/xp-metrics/${encodeURIComponent(metricId)}?depth=0`, {
          credentials: 'include', signal: controller.signal,
        })
        if (!response.ok) return
        const metric = await response.json() as { source?: string }
        const sources = JSON.parse(sourcesJson) as SerializedMetricSource[]
        if (!controller.signal.aborted) setMetricKind(sources.find(source => source.id === metric.source)?.kind)
      } catch { /* A failed metric read leaves the baseline as a plain number. */ }
    })()
    return () => controller.abort()
  }, [metricId, config.routes.api, sourcesJson])
  if (id == null) return <p>{C.save}</p>
  const view = preflight ? reviewView(preflight, { status, primaryMetricKind: metricKind }) : null
  const editable = status === 'draft' || status === 'stopped'
  const startAction = availableActions({ status, kind, arms, canManage: true }).find(action => action.id === 'start')
  const pending = busy || confirmStart
  const lockedReason = status === 'running' ? LOCKED_MESSAGES.running : status === 'decided' ? LOCKED_MESSAGES.decided : LOCKED_MESSAGES.archived
  const validValues = duration.trim() !== '' && Number.isInteger(Number(duration)) && Number(duration) > 0
    && tuning.trim() !== '' && Number.isFinite(Number(tuning)) && Number(tuning) >= 0
  function apply() {
    if (!editable || pending || loading || !view?.applyValues || !validValues) return
    dispatchFields({ type: 'UPDATE', path: 'analysis.plannedDurationDays', value: Number(duration) })
    dispatchFields({ type: 'UPDATE', path: 'analysis.sequentialTuningParameter', value: Number(tuning) })
    setModified(true)
    setRefresh(value => value + 1)
  }
  async function start() {
    if (id == null || inFlight.current || pending || loading || modified || !view?.canStart) return
    if (status === 'stopped') { setConfirmStart(true); return }
    inFlight.current = true
    setBusy(true)
    setError(null)
    const result = await api.start(id)
    if (result.ok) { reloadPage(); return }
    setError(result.message)
    inFlight.current = false
    setBusy(false)
  }
  return <div className="xp-review">
    {loading ? <p role="status">{C.loading}</p> : null}
    {view && preflight ? <>
      <ul>{view.checks.map((check, index) => <li key={index}>
        <span>{check.ok ? '✓' : '✗'} {check.ok ? check.done : check.hint}</span>{check.detail ? <p>{check.detail}</p> : null}
      </li>)}</ul>
      <ul>{view.placements.map(placement => <li key={`${placement.collection}/${placement.id}`}>
        {placement.ok ? '✓' : '✗'} {placement.title}{placement.detail ? <p>{placement.detail}</p> : null}
      </li>)}</ul>
      <fieldset disabled={pending || loading} style={{ border: 0, padding: 0 }}>
        <PreviewLinks experimentId={id} placements={preflight.placements} arms={arms} />
      </fieldset>
      <p>{view.baseline}</p><p>{view.traffic}</p>
      <p className={view.estimateWarning ? 'xp-review__warning' : undefined}
        style={view.estimateWarning ? { color: 'var(--theme-warning-600)' } : undefined}>{view.estimate}</p>
      {view.applyValues ? <>
        <label>{C.duration}<input type="number" min={1} step={1} value={duration} disabled={!editable || pending || loading}
          onChange={event => setDuration(event.target.value)} /></label>
        <label>{C.tuning}<input type="number" min={0} step="any" value={tuning} disabled={!editable || pending || loading}
          onChange={event => setTuning(event.target.value)} /></label>
        <Button disabled={!editable || pending || loading || !validValues} onClick={apply}>{C.apply}</Button>
      </> : null}
      {!editable ? <p>{lockedReason}</p> : null}
      {modified ? <p>{C.saveFirst}</p> : null}
      <Button disabled={!view.canStart || modified || pending || loading} onClick={() => { void start() }}>{startAction?.label ?? C.start}</Button>
    </> : null}
    {error ? <p role="alert">{error}</p> : null}
    {error && !preflight ? <Button disabled={pending || loading} onClick={() => setRefresh(value => value + 1)}>{C.retry}</Button> : null}
    {confirmStart && startAction ? <ConfirmDialog key={`${id}/start`} id={id} action={startAction} winnerLabel=""
      onClose={() => setConfirmStart(false)} /> : null}
  </div>
}
