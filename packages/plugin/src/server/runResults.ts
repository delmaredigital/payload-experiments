import { XpAnalysisError } from '../errors.js'
import { safeError } from '../log.js'
import { createLocalReq, type Payload } from 'payload'
import type { MetricUnavailableReason } from '../types/reasons.js'
import type { Snapshot } from '../types/snapshot.js'
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

type UnavailableMetric = { experimentId: DocId; phase: number; metricId: DocId; reason: MetricUnavailableReason }
async function analyseCandidate(exec: Executor, candidate: ResultsCandidate, options: ResolvedOptions, now: Date, deadline: number, unavailableMetrics: UnavailableMetric[], logger: Payload['logger']) {
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
  const identityConflicts = new Set<string>()
  const credit = (events: Array<{ unitId: string; value: number; ts: Date | number; userId?: string | null }>, userKeyed: boolean): MetricEvent[] => {
    if (candidate.unitType === 'user') return events.map(event => ({ ...event, unitId: event.userId ?? event.unitId }))
    const userEvents = events.filter(event => userKeyed || event.userId != null && linked.has(event.userId))
      .map(event => ({ userId: String(event.userId ?? event.unitId), value: event.value, ts: event.ts }))
    const credited = creditUserEvents(units, identities, userEvents, userId => identityConflicts.add(userId)).events
    return userKeyed ? credited : [...events.filter(event => event.userId == null || !linked.has(event.userId)), ...credited]
  }
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
        if (!options.eventSources?.some(source => source.name === eventName)) throw new XpAnalysisError('source-unavailable')
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
        if (!source || source.kind !== kind || definition.keyedBy && source.keyedBy !== definition.keyedBy) throw new XpAnalysisError('source-unavailable')
        const userKeyed = source.keyedBy === 'user' && candidate.unitType === 'visitor'
        if (candidate.unitType === 'user' && source.keyedBy !== 'user') throw new XpAnalysisError('unit-type-unavailable')
        const sourceIds = userKeyed ? userIds : ids
        events = credit(await raceDeadline(deadline, () => source.query({ from, to, unitIds: sourceIds })), userKeyed)
        if (phase.analysis.cuped === 'auto' && source.covariate) {
          // Ask for every linked user's pre-period even if their link is no longer
          // eligible now: eligibility is evaluated at each returned row's timestamp.
          const userStarts = new Map<string, number>()
          if (userKeyed) for (const link of identities) {
            const unit = units.get(link.anonymousId)
            if (unit) userStarts.set(link.userId, Math.min(userStarts.get(link.userId) ?? Infinity, timestampMs(unit.firstTs)))
          }
          const sourceUnits = userKeyed
            ? [...userStarts].map(([unitId, ts]) => ({ unitId, firstExposureTs: new Date(ts) }))
            : [...units].map(([unitId, unit]) => ({ unitId, firstExposureTs: new Date(timestampMs(unit.firstTs)) }))
          const pre = await raceDeadline(deadline, () => source.covariate!({ units: sourceUnits, lookbackDays: 14 }))
          if (pre.some(row => !Number.isFinite(row.value))) throw new XpAnalysisError('non-finite-covariates')
          const credited = credit(pre, userKeyed)
          const preUnits = new Map([...units].map(([id, unit]) => [id, { arm: unit.arm, firstTs: new Date(timestampMs(unit.firstTs) - 14 * 86_400_000) }]))
          covariates = perUnitValues(preUnits, credited, { kind, windowHours: 14 * 24 })
        }
      }
      if (events.some(event => !Number.isFinite(event.value))) throw new XpAnalysisError('non-finite-values')
      metricData.push({ metricId: definition.metricId, values: perUnitValues(units, events, { kind, windowHours, endedAt: to }), ...(covariates ? { covariates } : {}) })
    } catch (error) {
      let reason: MetricUnavailableReason = error instanceof ResultsBudgetError ? 'budget' : 'source-failed'
      if (error instanceof XpAnalysisError) {
        switch (error.code) {
          case 'source-unavailable':
          case 'unit-type-unavailable':
          case 'non-finite-values':
          case 'non-finite-covariates': reason = error.code; break
        }
      }
      logger.error({ err: safeError(error), experimentId: phase.experiment, metricId: definition.metricId }, 'Experiment metric source failed')
      metricData.push({ metricId: definition.metricId, values: new Map(), unavailable: reason })
      if (unavailableMetrics.length < 100) unavailableMetrics.push({ experimentId: phase.experiment, phase: phase.phase, metricId: definition.metricId, reason })
      if (error instanceof ResultsBudgetError || Date.now() >= deadline) throw new ResultsBudgetError()
    }
  }
  const status = phase.endedAt != null || candidate.status === 'archived' ? 'stopped' : candidate.status
  const snapshot = analysePhase({ phase: analysisPhase, now, units, metricData, status,
    onMetricError: (error, metricId) => logger.error({ err: safeError(error), experimentId: phase.experiment, metricId }, 'Experiment metric analysis failed'),
    excludedMultiArm: exposed.excludedMultiArm, armMismatch: await armMismatchCount(exec, query),
    identityConflictShare: userIds.length ? identityConflicts.size / userIds.length : 0,
    ...(phase.phaseKind === 'rollout' ? { winnerArm: phase.arms.find(arm => arm.kind !== 'holdout')!.key } : {}),
  })
  return snapshot
}

export async function runResults(payload: Payload, { budgetMs = 20_000, experimentId, sweep = true }: { budgetMs?: number; experimentId?: DocId; sweep?: boolean } = {}): Promise<{
  ran: number; skipped: number; failed: number; swept: number; processedIds: DocId[]; budgetExhausted: boolean; unavailableMetrics?: UnavailableMetric[]; sweepAttempted?: boolean
}> {
  if (!Number.isFinite(budgetMs) || budgetMs < 0) throw new RangeError('budgetMs must be finite and nonnegative')
  const started = Date.now(), deadline = started + budgetMs, now = new Date(started)
  const summary = { ran: 0, skipped: 0, failed: 0, swept: 0, processedIds: [] as DocId[], budgetExhausted: false, unavailableMetrics: [] as UnavailableMetric[], sweepAttempted: false }
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
    if (!(error instanceof ResultsBudgetError)) summary.failed++
    summary.budgetExhausted = error instanceof ResultsBudgetError
    payload.logger.error({ err: safeError(error), experimentId }, 'Experiment scheduling failed')
  }
  // Analysis precedes health-only refreshes, then oldest phase snapshots first;
  // grouping keeps each experiment's phases together with that priority.
  const experiments = new Map<DocId, ResultsCandidate[]>()
  for (const candidate of candidates) {
    const id = candidate.phase.experiment
    experiments.set(id, [...(experiments.get(id) ?? []), candidate])
  }
  for (const [id, phases] of experiments) {
    if (Date.now() >= analysisDeadline) { summary.budgetExhausted = true; summary.skipped += experiments.size - summary.ran - summary.skipped; break }
    try {
      const snapshots: Snapshot[] = []
      for (const phase of phases) {
        if (Date.now() >= analysisDeadline) throw new ResultsBudgetError()
        // Health refreshes must not reopen inference after the late-beacon grace.
        snapshots.push(phase.frozenSnapshot ? { ...phase.frozenSnapshot, computedAt: now.toISOString() }
          : await analyseCandidate(exec, phase, options, now, analysisDeadline, summary.unavailableMetrics, payload.logger))
      }
      if (Date.now() >= analysisDeadline) throw new ResultsBudgetError()
      const current = phases.find(candidate => candidate.kind === 'page' && candidate.phase.phase === candidate.currentPhase
        && (candidate.status === 'running' || candidate.status === 'decided'))
      if (current) {
        const req = await raceDeadline(analysisDeadline, () => createLocalReq({}, payload))
        const health: NonNullable<import('../types/snapshot.js').Snapshot['health']> = []
        // Decided tests serve only the winner and Original, including rollouts.
        const arms = current.phase.phaseKind === 'rollout'
          ? [...current.phase.arms.filter(arm => arm.kind !== 'holdout'), ...current.testArms.filter(arm => arm.kind === 'control')]
          : current.testArms.filter(arm => arm.kind !== 'holdout'
            && (current.status !== 'decided' || arm.kind === 'control' || arm.key === current.winnerArm))
        const targets = new Set(arms.flatMap(arm => arm.pageTarget ? [arm.pageTarget] : []))
        for (const path of targets) {
          let published = false, found = false, unchecked = false
          for (const collection of options.pages?.collections ?? []) {
            try {
              const page = await raceDeadline(analysisDeadline, () => collection.findByPath(path, req))
              found ||= page != null
              published ||= page?.published === true
            } catch (error) {
              if (error instanceof ResultsBudgetError) throw error
              payload.logger.error({ err: safeError(error), experimentId: id }, 'Experiment version page lookup failed')
              unchecked = true
            }
          }
          if (!published) health.push({ code: !found && (unchecked || !options.pages?.collections.length) ? 'version-page-unchecked' : 'version-page-unavailable', path })
        }
        for (const snapshot of snapshots) snapshot.health = health
      }
      if (Date.now() >= analysisDeadline) throw new ResultsBudgetError()
      // Order and optional empty health are semantically identical. Frozen
      // inference gets a new row only when its page availability changes.
      const canonicalHealth = (snapshot: Snapshot) => JSON.stringify((snapshot.health ?? [])
        .map(({ code, path }) => [code, path]).map(entry => JSON.stringify(entry)).sort((a, b) => a < b ? -1 : a > b ? 1 : 0))
      const changed = snapshots.filter((snapshot, index) => !phases[index]!.frozenSnapshot
        || canonicalHealth(snapshot) !== canonicalHealth(phases[index]!.frozenSnapshot!))
      // Unchanged health is a successful refresh with nothing to write.
      if (!changed.length) { summary.ran++; continue }
      await writeSnapshots(exec, changed)
      summary.ran++
      if (summary.processedIds.length < 100) summary.processedIds.push(id)
    } catch (error) {
      summary.skipped++
      if (!(error instanceof ResultsBudgetError)) summary.failed++
      summary.budgetExhausted ||= error instanceof ResultsBudgetError
      payload.logger.error({ err: safeError(error), experimentId: id }, 'Experiment results failed')
    }
  }
  if (sweep) {
    summary.sweepAttempted = true
    const sweepDeadline = deadline - RESULTS_TIMEOUT_MARGIN_MS
    try {
      const sweepExec = resultsExecutor(payload, () => sweepDeadline - Date.now())
      summary.swept = await sweepEvents(sweepExec, { now, retentionDays, shouldContinue: () => Date.now() < sweepDeadline, logger: payload.logger })
    } catch (error) {
      if (!(error instanceof ResultsBudgetError)) summary.failed++
      summary.budgetExhausted ||= error instanceof ResultsBudgetError
      payload.logger.error({ err: safeError(error) }, 'Experiment retention sweep failed')
    }
  }
  summary.budgetExhausted ||= Date.now() >= deadline
  return summary
}
