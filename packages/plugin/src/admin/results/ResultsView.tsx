'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Form, useAuth, useDocumentInfo } from '@payloadcms/ui'
import type { DocumentViewClientProps, FormState } from 'payload'
import type { DocId, Status } from '../../types/contracts.js'
import type { PhaseSummary, PreflightResult, ResultsResponse } from '../../types/endpoints.js'
import { useApi } from '../useApi.js'
import { canManage } from '../permissions.model.js'
import { armLabel } from '../labels.js'
import { RESULTS_COPY as C } from '../copy/results.js'
import { API_MESSAGES } from '../copy/common.js'
import { ExperimentActions } from '../actions/ExperimentActions.js'
import { PreviewLinks } from '../PreviewLinks.js'
import { VerdictCard } from './VerdictCard.js'
import { ArmTable } from './ArmTable.js'
import { DataQualityPanel } from './DataQualityPanel.js'
import { CiChart } from './CiChart.js'
import { armRows, collectingLine, dataQuality, defaultRound, guardrailChips, powerLine, rolloutLine, roundOptions, verdictCard } from './results.model.js'

type SavedExperiment = {
  status?: Status; decision?: { phase: number; winnerArm?: string } | null
  kind?: string; arms?: Array<{ key: string; kind?: string; label?: string }>
  metrics?: Record<string, unknown>
  layer?: unknown; layerSlices?: number[]; allocation?: number
}
type LoadState = { round: number | null } & (
  | { kind: 'loading'; data?: ResultsResponse } | { kind: 'ready'; data: ResultsResponse }
  | { kind: 'error' | 'forbidden'; message: string; data?: ResultsResponse }
)

function savedFormState(saved?: SavedExperiment): FormState {
  const fields: FormState = {}
  const field = (path: string, value: unknown) => { fields[path] = { value, initialValue: value } }
  for (const path of ['status', 'kind', 'allocation'] as const) field(path, saved?.[path])
  saved?.arms?.forEach((arm, index) => {
    for (const [key, value] of Object.entries(arm)) field(`arms.${index}.${key}`, value)
  })
  for (const [key, value] of Object.entries(saved?.decision ?? {})) field(`decision.${key}`, value)
  for (const [key, value] of Object.entries(saved?.metrics ?? {})) field(`metrics.${key}`, value)
  return fields
}

export function ResultsView(_props: DocumentViewClientProps) {
  const { id, data, initialState } = useDocumentInfo()
  const { permissions } = useAuth()
  const formState = useMemo(() => initialState ?? savedFormState(data as SavedExperiment | undefined), [initialState, data])
  if (id == null) return <p>{C.empty}</p>
  return <ResultsContent key={id} id={id} saved={data as SavedExperiment | undefined} formState={formState} manage={canManage(permissions)} />
}

function ResultsContent({ id, saved, formState, manage }: { id: DocId; saved?: SavedExperiment; formState: FormState; manage: boolean }) {
  const api = useApi()
  const status = saved?.status ?? 'draft'
  const decision = saved?.decision
  const [round, setRound] = useState<number | null>(null)
  const [phases, setPhases] = useState<PhaseSummary[]>([])
  const [state, setState] = useState<LoadState>({ round: null, kind: 'loading' })
  const [refresh, setRefresh] = useState(0)
  const [placements, setPlacements] = useState<PreflightResult['placements'] | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [previewRefresh, setPreviewRefresh] = useState(0)
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  const [actionError, setActionError] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    setState(previous => ({ round, kind: 'loading', data: previous.round === round ? previous.data : undefined }))
    void api.results(id, { ...(round === null ? {} : { phase: round }), series: true }).then(result => {
      if (!active) return
      if (!result.ok || !result.data) {
        setState(previous => ({ round, kind: !result.ok && result.status === 403 ? 'forbidden' : 'error',
          data: previous.round === round ? previous.data : undefined,
          message: result.ok ? API_MESSAGES.unreadable : result.message }))
        return
      }
      setPhases(result.data.phases)
      if (round === null) {
        const initial = defaultRound({ phases: result.data.phases, decision, status })
        if (initial !== null) { setRound(initial); return }
      }
      setState({ round, kind: 'ready', data: result.data })
    })
    return () => { active = false }
  }, [api, id, round, refresh, status, decision?.phase])

  useEffect(() => {
    let active = true
    setPlacements(null)
    setPreviewError(null)
    if (manage) void api.preflight(id).then(result => {
      if (!active) return
      if (result.ok && result.data) setPlacements(result.data.placements)
      else setPreviewError(result.ok ? API_MESSAGES.unreadable : result.message)
    })
    return () => { active = false }
  }, [api, id, manage, previewRefresh])

  async function recompute() {
    if (!manage || inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setActionError(null)
    try {
      const result = await api.recompute(id)
      if (result.ok) setRefresh(value => value + 1)
      else setActionError(result.message)
    } finally { inFlight.current = false; setBusy(false) }
  }
  const response = state.round === round ? state.data : undefined
  const phase = response?.phases.find(phase => phase.phase === round)
  const snapshot = response?.snapshot
  const isDecidedTestRound = status === 'decided' && phase?.phaseKind === 'test' && decision?.phase === round
  const winner = phase?.arms.find(arm => arm.key === decision?.winnerArm)?.label ?? armLabel(decision?.winnerArm ?? 'control')
  // Running is context for this round only, never the live status of an older round.
  const lineStatus = status === 'running' && round === defaultRound({ phases, status }) ? 'running' : 'stopped'
  const context = { phase, inLayer: saved?.layer != null, layerSlices: saved?.layerSlices, allocation: saved?.allocation }
  const primary = phase?.metrics.find(metric => metric.role === 'primary')
  return <div className="xp-results" style={{ color: 'var(--theme-text)' }}>
    {phases.length > 0 ? <label>{C.round}<select value={round ?? ''} onChange={event => setRound(Number(event.target.value))}>
      {roundOptions(phases).map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select></label> : null}
    {state.round !== round || state.kind === 'loading' ? <p role="status">{response ? C.refreshing : C.loading}</p>
      : state.kind === 'forbidden' ? <p role="alert">{C.forbidden}</p>
      : state.kind === 'error' ? <><p role="alert">{state.message}</p><Button onClick={() => setRefresh(value => value + 1)}>{C.retry}</Button></>
      : null}
    {phase && snapshot ? <>
        <VerdictCard model={verdictCard({ snapshot, decisionSnapshot: response?.decisionSnapshot, isDecidedTestRound, winnerLabel: winner })}
          guardrails={guardrailChips(snapshot)} power={powerLine({ snapshot, phaseKind: phase.phaseKind, status: lineStatus })}
          collecting={collectingLine({ snapshot, phaseKind: phase.phaseKind, status: lineStatus }, context)}
          sinceShipping={rolloutLine(snapshot, phase, phases, decision ?? undefined)} />
        <DataQualityPanel items={dataQuality(snapshot, context)} />
        {(['primary', 'secondary', 'guardrail'] as const).map(role => {
          const metrics = phase.metrics.filter(metric => metric.role === role)
          return metrics.length ? <section key={role}>
            <h2>{C[role]}</h2>
            {metrics.map(metric => <ArmTable key={metric.metricId} caption={metric.name} method={snapshot.method} metricKind={metric.kind}
              rows={armRows({ snapshot, phase, metricId: metric.metricId })} />)}
          </section> : null
        })}
        {primary ? <CiChart series={response?.series} metricId={primary.metricId} metricName={primary.name} phase={phase} contentChanges={snapshot.contentChanges} /> : null}
      </> : state.round === round && state.kind === 'ready' ? <p>{C.empty}</p> : null}
    {manage && placements ? <PreviewLinks experimentId={id} placements={placements} arms={saved?.arms ?? []} /> : null}
    {manage && previewError ? <><p role="alert">{previewError}</p><Button onClick={() => setPreviewRefresh(value => value + 1)}>{C.retryPreview}</Button></> : null}
    {/* This custom tab has no edit Form. Use DocumentInfo's saved state, with no submit surface. */}
    <Form initialState={formState} el="div">
      <ExperimentActions field={{ name: 'actions', type: 'ui', admin: {} }} path="actions" />
    </Form>
    {manage ? <Button disabled={busy} onClick={() => { void recompute() }}>{busy ? C.recomputing : C.recompute}</Button> : null}
    {actionError ? <p role="alert">{actionError}</p> : null}
  </div>
}
