'use client'

import { useEffect, useRef, useState } from 'react'
import { Button, useAuth, useDocumentInfo } from '@payloadcms/ui'
import type { DocumentViewClientProps } from 'payload'
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
  layer?: unknown; layerSlices?: number[]; allocation?: number
}
type LoadState = { round: number | null } & (
  | { kind: 'loading' } | { kind: 'ready'; data: ResultsResponse }
  | { kind: 'error' | 'forbidden'; message: string }
)

export function ResultsView(_props: DocumentViewClientProps) {
  const { id, data } = useDocumentInfo()
  const { permissions } = useAuth()
  if (id == null) return <p>{C.empty}</p>
  return <ResultsContent key={id} id={id} saved={data as SavedExperiment | undefined} manage={canManage(permissions)} />
}

function ResultsContent({ id, saved, manage }: { id: DocId; saved?: SavedExperiment; manage: boolean }) {
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
    setState({ round, kind: 'loading' })
    void api.results(id, { ...(round === null ? {} : { phase: round }), series: true }).then(result => {
      if (!active) return
      if (!result.ok || !result.data) {
        setState({ round, kind: !result.ok && result.status === 403 ? 'forbidden' : 'error',
          message: result.ok ? API_MESSAGES.unreadable : result.message })
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
  const response = state.round === round && state.kind === 'ready' ? state.data : null
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
    {state.round !== round || state.kind === 'loading' ? <p role="status">{C.loading}</p>
      : state.kind === 'forbidden' ? <p role="alert">{C.forbidden}</p>
      : state.kind === 'error' ? <><p role="alert">{state.message}</p><Button onClick={() => setRefresh(value => value + 1)}>{C.retry}</Button></>
      : !phase || !snapshot ? <p>{C.empty}</p>
      : <>
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
      </>}
    {manage && placements && phase ? <PreviewLinks experimentId={id} placements={placements} arms={phase.arms} /> : null}
    {manage && previewError ? <><p role="alert">{previewError}</p><Button onClick={() => setPreviewRefresh(value => value + 1)}>{C.retry}</Button></> : null}
    <ExperimentActions field={{ name: 'actions', type: 'ui', admin: {} }} path="actions" />
    {manage ? <Button disabled={busy} onClick={() => { void recompute() }}>{busy ? C.recomputing : C.recompute}</Button> : null}
    {actionError ? <p role="alert">{actionError}</p> : null}
  </div>
}
