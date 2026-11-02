'use client'
import '../../styles.js'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@payloadcms/ui'
import type { DocId } from '../../../types/contracts.js'
import type { PreflightResult } from '../../../types/endpoints.js'
import type { SurfaceProps } from '../contracts.js'
import { RESULTS_COPY as C } from '../../copy/results.js'
import { RESULTS_SURFACE_COPY } from '../../copy/recommendation.js'
import { ACTIONS_COPY } from '../../copy/actions.js'
import { API_MESSAGES } from '../../copy/common.js'
import { armLabel } from '../../labels.js'
import { PreviewLinks } from '../../PreviewLinks.js'
import { VerdictCard } from '../../results/VerdictCard.js'
import { ArmTable } from '../../results/ArmTable.js'
import { DataQualityPanel } from '../../results/DataQualityPanel.js'
import { CiChart } from '../../results/CiChart.js'
import { armRows, collectingLine, dataQuality, defaultRound, guardrailChips, powerLine, rolloutLine, roundOptions, verdictCard } from '../../results/results.model.js'
import { recommendation } from './recommendation.model.js'
import { useResults } from './useResults.js'
import { DecideDialog } from '../../actions/DecideDialog.js'

export function ResultsBody({ id, surface }: { id: DocId; surface: SurfaceProps }) {
  // A different test owns an independent selection and action lifecycle.
  return <ResultsContent key={`${surface.apiRoute}/${id}`} id={id} surface={surface} />
}

function ResultsContent({ id, surface }: { id: DocId; surface: SurfaceProps }) {
  const results = useResults(id, surface)
  const { api, doc, round, phases, state, data } = results
  const manage = surface.canManage && surface.canReadResults
  const [placements, setPlacements] = useState<PreflightResult['placements'] | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [previewRefresh, setPreviewRefresh] = useState(0)
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  const mounted = useRef(true)
  const [actionError, setActionError] = useState<string | null>(null)
  const [deciding, setDeciding] = useState(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
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
      if (!mounted.current) return
      if (result.ok) results.reload()
      else setActionError(result.message)
    } finally {
      inFlight.current = false
      if (mounted.current) setBusy(false)
    }
  }
  const phase = data?.phases.find(phase => phase.phase === round)
  const snapshot = data?.snapshot
  const newestRound = defaultRound({ phases, status: 'running' })
  const latestPhase = phases.find(phase => phase.phase === newestRound)
  const decision = data?.decision ?? doc?.decision
  const status = data?.decision ? 'decided' : doc?.status ?? (latestPhase?.phaseKind === 'test' && latestPhase.endedAt === null ? 'running' : 'stopped')
  // ADM-06b: an older round never inherits the live test's running status.
  const lineStatus = status === 'running' && round === newestRound ? 'running' : 'stopped'
  const isDecidedTestRound = status === 'decided' && phase?.phaseKind === 'test' && decision?.phase === round
  const winner = phase?.arms.find(arm => arm.key === decision?.winnerArm)?.label ?? armLabel(decision?.winnerArm ?? 'control')
  const card = snapshot ? verdictCard({ snapshot, decisionSnapshot: data?.decisionSnapshot, isDecidedTestRound, winnerLabel: winner }) : null
  const context = { phase, inLayer: doc?.layer != null, layerSlices: doc?.layerSlices, allocation: doc?.allocation }
  const primary = phase?.metrics.find(metric => metric.role === 'primary')
  // The endpoint decides the current round; historical rounds are read-only.
  const canDecide = manage && (status === 'running' || status === 'stopped') && phase?.phaseKind === 'test'
    && round === newestRound && state === 'ready' && Boolean(snapshot)
  return <div className="xp-results" style={{ color: 'var(--theme-text)' }}>
    {phases.length > 0 ? <label>{C.round}<select disabled={deciding} value={round ?? ''} onChange={event => results.setRound(Number(event.target.value))}>
      {roundOptions(phases).map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select></label> : null}
    {state === 'loading' ? <p role="status">{data ? C.refreshing : C.loading}</p>
      : state === 'forbidden' ? <p role="alert">{C.forbidden}</p>
      : state === 'missing' ? <p role="alert">{RESULTS_SURFACE_COPY.missing}</p>
      : state === 'error' ? <><p role="alert">{results.error}</p><Button onClick={results.reload}>{C.retry}</Button></>
      : null}
    {phase && snapshot ? <>
      <div style={{ background: 'var(--theme-elevation-50)', paddingTop: '1rem' }}>
        <p className="xp-recommendation" style={{ margin: '0 1rem' }}>{recommendation({ snapshot, phase, status: lineStatus,
          plannedDurationDays: round === newestRound ? doc?.analysis?.plannedDurationDays : undefined })}</p>
        <VerdictCard model={card!}
          guardrails={guardrailChips(snapshot)} power={powerLine({ snapshot, phaseKind: phase.phaseKind, status: lineStatus })}
          collecting={collectingLine({ snapshot, phaseKind: phase.phaseKind, status: lineStatus }, context)}
          sinceShipping={rolloutLine(snapshot, phase, phases, decision ?? undefined)} />
      </div>
      <DataQualityPanel items={dataQuality(snapshot, context)} />
      {(['primary', 'secondary', 'guardrail'] as const).map(role => {
        const metrics = phase.metrics.filter(metric => metric.role === role)
        return metrics.length ? <section key={role}>
          <h2>{C[role]}</h2>
          {metrics.map(metric => <ArmTable key={metric.metricId} caption={metric.name} method={snapshot.method} metricKind={metric.kind}
            rows={armRows({ snapshot, phase, metricId: metric.metricId })} />)}
        </section> : null
      })}
      {primary ? <CiChart series={data?.series} metricId={primary.metricId} metricName={primary.name} phase={phase} contentChanges={snapshot.contentChanges} /> : null}
    </> : state === 'empty' || state === 'ready' ? <p>{C.empty}</p> : null}
    {manage && placements ? <PreviewLinks experimentId={id} placements={placements} arms={doc?.arms ?? []} /> : null}
    {manage && previewError ? <><p role="alert">{previewError}</p><Button onClick={() => setPreviewRefresh(value => value + 1)}>{C.retryPreview}</Button></> : null}
    {manage ? <Button disabled={busy || deciding} onClick={() => { void recompute() }}>{busy ? C.recomputing : C.recompute}</Button> : null}
    {canDecide ? <Button disabled={busy || deciding} onClick={() => setDeciding(true)}>{ACTIONS_COPY.decide}</Button> : null}
    {deciding && manage && phase ? <DecideDialog id={id} arms={phase.arms} onClose={() => setDeciding(false)} /> : null}
    {actionError ? <p role="alert">{actionError}</p> : null}
  </div>
}
