'use client'
import { theme } from '../../theme.js'
import '../../styles.js'

import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Button } from '../../../ui/Button.js'
import { Select } from '../../../ui/Inputs.js'
import type { DocId } from '../../../types/contracts.js'
import type { PreflightResult, ResultsResponse } from '../../../types/endpoints.js'
import type { SurfaceProps } from '../contracts.js'
import { RESULTS_COPY as C } from '../../copy/results.js'
import { formatDate } from '../../format/date.js'
import { ACTIONS_COPY } from '../../copy/actions.js'
import { METRICS_COPY } from '../../copy/metrics.js'
import { API_MESSAGES } from '../../copy/common.js'
import { armLabel } from '../../labels.js'
import { PreviewLinks } from '../../PreviewLinks.js'
import { actionablePreviewPages } from '../../previewLinks.model.js'
import { VerdictHero } from '../../results/VerdictHero.js'
import { StatTile } from '../../results/StatTile.js'
import { DataTable, Swatch } from '../../results/DataTable.js'
import { daysOfPlan } from '../../copy/results.js'
import { formatCount, formatPercent } from '../../results/format.js'
import { DataQualityPanel } from '../../results/DataQualityPanel.js'
import { CiChart } from '../../results/CiChart.js'
import { armRows, collectingLine, dataQuality, defaultRound, guardrailChips, powerLine, rolloutLine, roundOptions, verdictCard } from '../../results/results.model.js'
import { recommendation } from './recommendation.model.js'
import { useResults } from './useResults.js'
import { DecideDialog } from '../../actions/DecideDialog.js'
import { Banner } from '../../../ui/Banner.js'
import { canReleasePages } from '../../results/releasePages.model.js'
import { PagesReleased, ReleasePagesDialog } from './ReleasePages.js'
import { usePlacementLabels } from '../../placements/usePlacementLabels.js'

export type ResultsPageParts = { children: ReactNode; actions: ReactNode; released: ReactNode; data?: ResultsResponse }
type ResultsBodyProps = { renderPage?: (parts: ResultsPageParts) => ReactNode; id: DocId; surface: SurfaceProps; onRecomputed?: () => void; onPagesReleased?: () => void }

export function ResultsBody({ id, surface, onRecomputed, onPagesReleased, renderPage }: ResultsBodyProps) {
  // A different test owns an independent selection and action lifecycle.
  return <ResultsContent key={`${surface.apiRoute}/${id}`} id={id} surface={surface} onRecomputed={onRecomputed} onPagesReleased={onPagesReleased} renderPage={renderPage} />
}

function ResultsContent({ id, surface, onRecomputed, onPagesReleased, renderPage }: ResultsBodyProps) {
  const results = useResults(id, surface)
  const { api, doc, round, phases, state, data } = results
  const manage = surface.canManage && surface.canReadResults
  const [placements, setPlacements] = useState<PreflightResult['placements'] | null>(null)
  const [checks, setChecks] = useState<PreflightResult['checks']>([])
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [previewRefresh, setPreviewRefresh] = useState(0)
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  const mounted = useRef(true)
  const [actionError, setActionError] = useState<string | null>(null)
  const [deciding, setDeciding] = useState(false)
  const [releasing, setReleasing] = useState(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    let active = true
    setPlacements(null)
    setChecks([])
    setPreviewError(null)
    if (manage) void api.preflight(id).then(result => {
      if (!active) return
      if (result.ok && result.data) { setPlacements(result.data.placements); setChecks(result.data.checks) }
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
      if (result.ok) {
        results.reload()
        onRecomputed?.()
      }
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
  const status = doc?.status ?? (data?.decision ? 'decided' : latestPhase?.phaseKind === 'test' && latestPhase.endedAt === null ? 'running' : 'stopped')
  // ADM-06b: an older round never inherits the live test's running status.
  const lineStatus = status === 'running' && round === newestRound ? 'running' : 'stopped'
  const isDecidedTestRound = status === 'decided' && phase?.phaseKind === 'test' && decision?.phase === round
  const showingDecision = isDecidedTestRound && Boolean(data?.decisionSnapshot)
  const shown = showingDecision ? data!.decisionSnapshot! : snapshot
  const winner = phase?.arms.find(arm => arm.key === decision?.winnerArm)?.label ?? armLabel(decision?.winnerArm ?? 'control')
  const card = shown ? verdictCard({ snapshot: shown, decisionSnapshot: data?.decisionSnapshot, isDecidedTestRound, winnerLabel: winner }) : null
  const placementLabels = usePlacementLabels({
    details: shown?.health?.filter(item => item.code === 'placement-unchecked').map(item => item.detail) ?? [],
    apiRoute: surface.apiRoute, adminRoute: surface.adminRoute, canManage: manage,
  })
  const context = { status, phase, inLayer: doc?.layer != null, layerSlices: doc?.layerSlices, allocation: doc?.allocation, placementLabels }
  const primary = phase?.metrics.find(metric => metric.role === 'primary')
  // The endpoint decides the current round; historical rounds are read-only.
  const canDecide = manage && (status === 'running' || status === 'stopped') && phase?.phaseKind === 'test'
    && round === newestRound && state === 'ready' && Boolean(shown)
  const actions = <>
      {canDecide ? <Button disabled={busy || deciding || releasing} onClick={() => setDeciding(true)}>{ACTIONS_COPY.decide}</Button> : null}
      {manage && doc && canReleasePages(doc) ? <Button variant="secondary" disabled={busy || deciding || releasing} onClick={() => {
        setActionError(null)
        setReleasing(true)
      }}>{C.releasePages}</Button> : null}
    </>
  // Release details come only from the manager's own document, never the results response.
  const released = manage && doc?.decision?.pagesReleasedAt ? <PagesReleased decision={doc.decision} apiRoute={surface.apiRoute} /> : null
  const meta = <><div className="xp-round-meta">
    {phases.length > 0 ? <Select id="xp-results-round" label={C.round} disabled={deciding || releasing} value={round ?? ''} onChange={event => results.setRound(Number(event.target.value))}>
      {roundOptions(phases).map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </Select> : null}{manage && shown ? <span>· {C.methods[shown.method]}</span> : null}{showingDecision ? <span className="xp-results-as-of">{manage ? '· ' : ''}{C.asOfDecision(formatDate(data!.decisionSnapshot!.computedAt))}</span> : null}
    </div>{/* The decided round shows the decision's numbers, so a recompute would change nothing here. */}{manage && !showingDecision ? <Button variant="quiet" size="sm" disabled={busy || deciding || releasing} onClick={() => { void recompute() }}>{busy ? C.recomputing : C.recompute}</Button> : null}</>
  const leader = shown?.verdict.recommendedArm
  const leadingComparison = shown?.metrics.find(metric => metric.role === 'primary')?.comparisons.find(item => item.arm === leader)
  const chance = shown?.method === 'bayesian' && !['collecting', 'rollout-collecting'].includes(shown.verdict.code)
    ? leadingComparison?.chanceToWin : undefined
  const days = shown ? Math.max(0, Math.floor((Date.parse(shown.window.to) - Date.parse(phase?.startedAt ?? shown.window.from)) / 86400000)) : undefined
  const planned = doc?.analysis?.plannedDurationDays
  const content = <div className="xp-results" style={{ color: theme.color.text }}>
    {actionError ? <Banner tone="error">{actionError}</Banner> : null}
    {!renderPage ? <><div className="xp-ui-button-group">{actions}</div>{released}</> : null}
    {state === 'loading' ? <p role="status">{data ? C.refreshing : C.loading}</p>
      : state === 'forbidden' ? <p role="alert">{C.forbidden}</p>
      : state === 'missing' ? <p role="alert">{results.error}</p>
      : state === 'error' ? <><p role="alert">{results.error}</p><Button onClick={results.reload}>{C.retry}</Button></>
      : null}
    {phase && shown ? <>
      <VerdictHero model={card!} meta={meta} recommendation={recommendation({ snapshot: shown, phase, status: lineStatus, plannedDurationDays: round === newestRound ? doc?.analysis?.plannedDurationDays : undefined })}
        guardrails={guardrailChips(shown)} power={powerLine({ snapshot: shown, phaseKind: phase.phaseKind, status: lineStatus })}
        collecting={collectingLine({ snapshot: shown, phaseKind: phase.phaseKind, status: lineStatus }, context)}
        sinceShipping={rolloutLine(shown, phase, phases, decision ?? undefined)} />
      {primary?.clickGoal ? <p>{C.clickPrimary}</p> : null}
      <div className="xp-stat-tiles">
        <StatTile label={C.people} value={formatCount(shown.exposures.total)} />
        <StatTile label={C.days} value={planned ? daysOfPlan(formatCount(days), formatCount(planned)) : formatCount(days)} />
        <StatTile label={C.chanceToWin} value={formatPercent(chance)} detail={chance != null && leader ? <><Swatch arm={leader} />{phase.arms.find(arm => arm.key === leader)?.label ?? armLabel(leader)}</> : undefined} />
      </div>
      {phase.metrics.filter(metric => metric.role === 'primary').map(metric => <MetricTable key={metric.metricId} metric={metric} snapshot={shown} phase={phase} leader={leader} />)}
      {primary ? <details className="xp-results-panel xp-chart-details"><summary>{C.chart}</summary>
        <CiChart series={data?.series} metricId={primary.metricId} metricName={primary.name} phase={phase} contentChanges={shown.contentChanges} />
      </details> : null}
      {shown.goalFairnessNotice ? <p>{shown.goalFairnessNotice}</p> : null}
      <DataQualityPanel problem={shown.verdict.code === 'data-problem'} items={dataQuality(shown, context)} />
      {(['guardrail', 'secondary'] as const).map(role => phase.metrics.filter(metric => metric.role === role).map(metric =>
        <MetricTable key={metric.metricId} metric={metric} snapshot={shown} phase={phase} />))}
    </> : <>{meta}{state === 'empty' || state === 'ready' ? <p>{C.empty}</p> : null}</>}
    {manage && placements && actionablePreviewPages(placements, doc?.flagPoint).length > 0 ? <section className="xp-results-block"><div className="xp-results-block-head"><h2>{C.previews}</h2></div><PreviewLinks experimentId={id} flagPoint={doc?.flagPoint} placements={placements} arms={doc?.arms ?? []} /></section> : null}
    {manage && previewError ? <><p role="alert">{previewError}</p><Button onClick={() => setPreviewRefresh(value => value + 1)}>{C.retryPreview}</Button></> : null}
    {deciding && manage && phase ? <DecideDialog id={id} arms={phase.arms} checks={checks} onClose={() => setDeciding(false)} /> : null}
    {releasing && manage ? <ReleasePagesDialog id={id} apiRoute={surface.apiRoute} onClose={() => setReleasing(false)}
      onRefusal={setActionError} onSuccess={() => { results.reload(); onPagesReleased?.() }} /> : null}
  </div>
  return renderPage ? renderPage({ children: content, actions, released, data }) : content
}

function MetricTable({ metric, snapshot, phase, leader }: {
  metric: import('../../../types/endpoints.js').PhaseSummary['metrics'][number]
  snapshot: import('../../../types/snapshot.js').Snapshot
  phase: import('../../../types/endpoints.js').PhaseSummary
  leader?: string | null
}) {
  const rows = armRows({ snapshot, phase, metricId: metric.metricId })
  const guardrail = snapshot.guardrails.find(item => item.metricId === metric.metricId)
  const notices = [...new Set(rows.map(row => row.capped.notice).filter(Boolean))]
  return <section className="xp-results-block"><div className="xp-results-block-head">
    <h2>{C[metric.role]}</h2><div className="xp-results-block-meta">{metric.name}<span className="xp-tests-kind">{C.kinds[metric.kind]}</span>
      {metric.role === 'guardrail' && guardrail ? <span className={`xp-quality-chip xp-quality-chip--${guardrail.status === 'failing' ? 'problem' : guardrail.status === 'ok' ? 'ok' : 'watch'}`}>{C.guardrails[guardrail.status]}</span> : null}
    </div></div>
    <DataTable caption={metric.name} method={snapshot.method} metricKind={metric.kind} rows={rows} primary={metric.role === 'primary'} leader={leader} />
    {metric.kind === 'revenue' ? (notices.length ? notices : [METRICS_COPY.revenueHint]).map(notice => <p className="xp-results-cap-help" key={notice}>{notice}</p>) : null}
  </section>
}
