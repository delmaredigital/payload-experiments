import type { Payload } from 'payload'
import type { DocId } from '../types/contracts.js'
import type { ResolvedOptions } from '../types/contracts.js'
import { resultsCandidates, resultsExecutor, writeSnapshots, type ResultsCandidate } from '../db/snapshots.js'
import { sweepEvents } from '../db/sweep.js'
import { armMismatchCount, identityRows, metricEventRows, phaseExposureRows, rolloutExposureRows } from '../db/results.js'
import type { Executor } from '../db/executor.js'
import { raceDeadline, ResultsBudgetError, RESULTS_TIMEOUT_MARGIN_MS } from '../db/executor.js'
import { analysePhase, type MetricUnitData } from '../results/analyse.js'
import { firstExposures, perUnitValues, timestampMs, type MetricEvent } from '../results/aggregate.js'
import { rolloutAnalysisUnits } from '../results/rolloutUnits.js'
import { creditUserEvents } from '../results/identityCredit.js'

type UnavailableMetric = { experimentId: DocId; phase: number; metricId: DocId; reason: string }
async function analyseCandidate(exec: Executor, candidate: ResultsCandidate, options: ResolvedOptions, now: Date, deadline: number, unavailableMetrics: UnavailableMetric[]) {
  const { phase } = candidate
  // Rollout assignment preserves the original test ranges, but its SRM compares
  // only the shipped group against holdout with weights {100-h, h}.
  const analysisPhase = phase.phaseKind === 'rollout' ? { ...phase, arms: phase.arms.map(arm => ({ ...arm,
    weight: arm.kind === 'holdout' ? candidate.testArms.at(-1)!.weight : 100 - candidate.testArms.at(-1)!.weight,
  })) } : phase
  const to = new Date(Math.min(+now, phase.endedAt == null ? Infinity : timestampMs(phase.endedAt)))
  const query = { experimentId: phase.experiment, phase: phase.phase, endedAt: to }
  const exposed = firstExposures(await phaseExposureRows(exec, query), { endedAt: to })
  let units = exposed.units
  if (phase.phaseKind === 'rollout') {
    const eligible = rolloutAnalysisUnits({ exposuresAllPhases: await rolloutExposureRows(exec, { ...query, respectPhaseEnds: true }), rolloutPhase: phase.phase,
      seed: phase.seed, testWeights: candidate.testArms.map(arm => arm.weight),
      coverage: candidate.layerSlug ? 1 : phase.allocation / 100,
      ...(candidate.layerSlug && candidate.layerSlices?.length ? { layer: { slug: candidate.layerSlug, slices: candidate.layerSlices } } : {}),
    })
    units = new Map([...units].filter(([id]) => eligible.has(id)))
  }
  const ids = [...units.keys()]
  const identities = candidate.unitType === 'visitor' ? await identityRows(exec, { anonymousIds: ids }) : []
  const userIds = [...new Set(identities.map(identity => identity.userId))]
  const linked = new Set(userIds)
  const credit = (events: Array<{ unitId: string; value: number; ts: Date | number; userId?: string | null }>, userKeyed: boolean): MetricEvent[] => {
    if (candidate.unitType === 'user') return events.map(event => ({ ...event, unitId: event.userId ?? event.unitId }))
    const userEvents = events.filter(event => userKeyed || event.userId != null && linked.has(event.userId))
      .map(event => ({ userId: String(event.userId ?? event.unitId), value: event.value, ts: event.ts }))
    const credited = creditUserEvents(units, identities, userEvents).events
    return userKeyed ? credited : [...events.filter(event => event.userId == null || !linked.has(event.userId)), ...credited]
  }
  const diagnostics = creditUserEvents(units, identities, [])
  const metricData: MetricUnitData[] = []
  for (const definition of phase.metricDefinitions) {
    try {
      if (Date.now() >= deadline) throw new ResultsBudgetError()
      const kind = definition.kind
      const windowHours = phase.analysis.attributionWindowHours ?? definition.attributionWindowHours ?? 168
      const from = new Date([...units.values()].reduce((earliest, unit) => Math.min(earliest, +unit.firstTs), timestampMs(phase.startedAt)))
      const preFrom = new Date(+from - 14 * 86_400_000)
      let events: MetricEvent[], covariates: Map<string, number> | undefined
      if (definition.source.startsWith('events:')) {
        const eventName = definition.source.slice(7)
        if (!options.eventSources?.some(source => source.name === eventName)) throw new Error('Metric source unavailable')
        const read = async (start: Date) => {
          if (candidate.unitType === 'user') return metricEventRows(exec, { eventName, userIds: ids, from: start, to })
          const direct = await metricEventRows(exec, { eventName, unitIds: ids, from: start, to })
          const signedIn = await metricEventRows(exec, { eventName, userIds, from: start, to })
          return [...direct, ...signedIn]
        }
        events = credit(await read(phase.analysis.cuped === 'auto' ? preFrom : from), false)
        if (phase.analysis.cuped === 'auto') {
          const preUnits = new Map([...units].map(([id, unit]) => [id, { arm: unit.arm, firstTs: new Date(+unit.firstTs - 14 * 86_400_000) }]))
          covariates = perUnitValues(preUnits, events, { kind, windowHours: 14 * 24 })
        }
      } else {
        const source = options.metricSources?.find(source => source.id === definition.source)
        if (!source || source.kind !== kind || definition.keyedBy && source.keyedBy !== definition.keyedBy) throw new Error('Metric source unavailable')
        const userKeyed = source.keyedBy === 'user' && candidate.unitType === 'visitor'
        if (candidate.unitType === 'user' && source.keyedBy !== 'user') throw new Error('Metric unit type unavailable')
        const sourceIds = userKeyed ? userIds : ids
        events = credit(await raceDeadline(deadline, () => source.query({ from, to, unitIds: sourceIds })), userKeyed)
        if (phase.analysis.cuped === 'auto' && source.covariate) {
          const sourceUnits = userKeyed
            ? creditUserEvents(units, identities, userIds.map(userId => ({ userId, ts: now, value: 0 }))).events.map(event => ({
              unitId: identities.find(identity => identity.anonymousId === event.unitId)!.userId,
              firstExposureTs: units.get(event.unitId)!.firstTs,
            }))
            : [...units].map(([unitId, unit]) => ({ unitId, firstExposureTs: unit.firstTs }))
          const pre = await raceDeadline(deadline, () => source.covariate!({ units: sourceUnits, lookbackDays: 14 }))
          if (pre.some(row => !Number.isFinite(row.value))) throw new Error('Covariates must be finite')
          const credited = credit(pre.map(row => ({ ...row, ts: now })), userKeyed)
          covariates = new Map(credited.map(row => [row.unitId, row.value]))
        }
      }
      if (events.some(event => !Number.isFinite(event.value))) throw new Error('Metric values must be finite')
      metricData.push({ metricId: definition.metricId, values: perUnitValues(units, events, { kind, windowHours, endedAt: to }), ...(covariates ? { covariates } : {}) })
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Metric source unavailable'
      metricData.push({ metricId: definition.metricId, values: new Map(), unavailable: reason })
      if (unavailableMetrics.length < 100) unavailableMetrics.push({ experimentId: phase.experiment, phase: phase.phase, metricId: definition.metricId, reason })
      if (error instanceof ResultsBudgetError || Date.now() >= deadline) throw new ResultsBudgetError()
    }
  }
  const status = phase.endedAt != null || candidate.status === 'archived' ? 'stopped' : candidate.status
  const snapshot = analysePhase({ phase: analysisPhase, now, units, metricData, status,
    excludedMultiArm: exposed.excludedMultiArm, armMismatch: await armMismatchCount(exec, query),
    identityConflictShare: userIds.length ? diagnostics.conflicts / userIds.length : 0,
    ...(phase.phaseKind === 'rollout' ? { winnerArm: phase.arms.find(arm => arm.kind !== 'holdout')!.key } : {}),
  })
  return snapshot
}

export async function runResults(payload: Payload, { budgetMs = 20_000, experimentId, sweep = true }: { budgetMs?: number; experimentId?: DocId; sweep?: boolean } = {}): Promise<{
  ran: number; skipped: number; swept: number; processedIds: DocId[]; budgetExhausted: boolean; unavailableMetrics?: UnavailableMetric[]; sweepAttempted?: boolean
}> {
  if (!Number.isFinite(budgetMs) || budgetMs < 0) throw new RangeError('budgetMs must be finite and nonnegative')
  const started = Date.now(), deadline = started + budgetMs, now = new Date(started)
  const summary = { ran: 0, skipped: 0, swept: 0, processedIds: [] as DocId[], budgetExhausted: false, unavailableMetrics: [] as UnavailableMetric[], sweepAttempted: false }
  if (budgetMs === 0) return { ...summary, budgetExhausted: true }
  const options = payload.config.custom?.xp as ResolvedOptions
  const retentionDays = options.events?.retentionDays ?? 180
  // Reserve up to one second (25% of short runs) for retention, even when host
  // code never settles. The safety margin also leaves time to return the summary.
  const analysisDeadline = deadline - (sweep ? Math.min(1000, budgetMs / 4) : 0) - RESULTS_TIMEOUT_MARGIN_MS
  const exec = resultsExecutor(payload, () => analysisDeadline - Date.now())
  let candidates: ResultsCandidate[] = []
  try {
    candidates = await resultsCandidates(exec, { cutoff: new Date(started - retentionDays * 86_400_000).toISOString(), experimentId })
  } catch (error) {
    summary.skipped++
    summary.budgetExhausted = error instanceof ResultsBudgetError
    payload.logger.error({ err: error, experimentId }, 'Experiment scheduling failed')
  }
  // Query order is oldest phase snapshot first; grouping keeps each experiment's
  // phases together while preserving that scheduling priority.
  const experiments = new Map<DocId, ResultsCandidate[]>()
  for (const candidate of candidates) {
    const id = candidate.phase.experiment
    experiments.set(id, [...(experiments.get(id) ?? []), candidate])
  }
  for (const [id, phases] of experiments) {
    if (Date.now() >= analysisDeadline) { summary.budgetExhausted = true; summary.skipped += experiments.size - summary.ran - summary.skipped; break }
    try {
      const snapshots = []
      for (const phase of phases) {
        if (Date.now() >= analysisDeadline) throw new ResultsBudgetError()
        snapshots.push(await analyseCandidate(exec, phase, options, now, analysisDeadline, summary.unavailableMetrics))
      }
      if (Date.now() >= analysisDeadline) throw new ResultsBudgetError()
      await writeSnapshots(exec, snapshots)
      summary.ran++
      if (summary.processedIds.length < 100) summary.processedIds.push(id)
    } catch (error) {
      summary.skipped++
      summary.budgetExhausted ||= error instanceof ResultsBudgetError
      payload.logger.error({ err: error, experimentId: id }, 'Experiment results failed')
    }
  }
  if (sweep) {
    summary.sweepAttempted = true
    const sweepDeadline = deadline - RESULTS_TIMEOUT_MARGIN_MS
    try {
      const sweepExec = resultsExecutor(payload, () => sweepDeadline - Date.now())
      summary.swept = await sweepEvents(sweepExec, { now, retentionDays, shouldContinue: () => Date.now() < sweepDeadline, logger: payload.logger })
    } catch (error) {
      summary.budgetExhausted ||= error instanceof ResultsBudgetError
      payload.logger.error({ err: error }, 'Experiment retention sweep failed')
    }
  }
  summary.budgetExhausted ||= Date.now() >= deadline
  return summary
}
