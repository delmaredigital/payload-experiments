import type { PayloadRequest } from 'payload'
import { powerMetricWeeks } from '@delmaredigital/experiments-stats'
import type { PowerMetricParams, PowerWeeksInput, PowerWeeksResult } from '@delmaredigital/experiments-stats'
import type { DocId, MetricSource, ResolvedOptions } from '../types/contracts.js'
import type { PreflightResult } from '../types/endpoints.js'
import { checkStart, relationshipId } from './checkStart.js'
import type { CheckStartInput, StartExperiment, StartMetric } from './checkStart.js'
import { flagPlacements, scanBlockPlacements } from './placements.js'

export interface PreflightDependencies {
  now?: Date
  estimate?: (input: PowerWeeksInput) => PowerWeeksResult | Promise<PowerWeeksResult>
}
const failureDetail = (cause: unknown) => cause instanceof Error ? cause.message : 'Placement lookup failed.'

/** Read-only inputs shared with Start's pre-transaction checks. Start must re-read
 * the document and lock-sensitive facts inside its transition (CORE-10b).
 */
export async function loadStartInputs<TUser extends { id: DocId }>(req: PayloadRequest, options: ResolvedOptions<TUser>, experimentId: DocId): Promise<CheckStartInput | null> {
  const found = await req.payload.find({ collection: 'xp-experiments', req, overrideAccess: false, depth: 0, limit: 1, where: { id: { equals: experimentId } } })
  if (!found.docs[0]) return null
  const experiment = found.docs[0] as unknown as StartExperiment
  const ids = [experiment.metrics?.primary, ...experiment.metrics?.secondary ?? [], ...experiment.metrics?.guardrails ?? []].map(relationshipId).filter((id): id is DocId => id !== undefined)
  const metrics: StartMetric[] = []
  if (ids.length) {
    let page = 1
    while (true) {
      const result = await req.payload.find({ collection: 'xp-metrics', req, overrideAccess: false, depth: 0, limit: 100, page, where: { id: { in: ids } } })
      metrics.push(...result.docs as unknown as StartMetric[])
      if (!result.hasNextPage) break
      page++
    }
  }
  const input: CheckStartInput = { experiment, metrics, metricSources: options.metricSources, flagPoints: options.flagPoints, attributeKeys: options.attributeKeys }
  if (experiment.kind === 'block') {
    try { input.placements = await scanBlockPlacements(req, { slug: experiment.slug, puckCollections: options.puck?.collections ?? [] }) }
    catch (cause) { input.placementError = failureDetail(cause) }
  }
  if (experiment.kind === 'flag') {
    const point = options.flagPoints?.find(point => point.id === experiment.flagPoint)
    if (point) {
      // Match the save hook: the control always uses effective point defaults.
      let params = point.defaultParams
      try {
        const state = await req.payload.findGlobal({ slug: 'xp-state', req, overrideAccess: false, depth: 0 })
        const defaults = state.flagDefaults as Record<string, { params: Record<string, unknown> }> | undefined
        params = defaults?.[point.id]?.params ?? params
      } catch (cause) {
        const error = cause as { status?: unknown; name?: unknown } | null
        if (error?.status !== 403 && error?.name !== 'Forbidden') throw cause
      }
      experiment.arms = experiment.arms.map(arm => arm.kind === 'control' ? { ...arm, params } : arm)
    }
    if (point?.placements) {
      try {
        const placements = await flagPlacements(options, experiment, req)
        if (Array.isArray(placements) && placements.every(p => p && typeof p === 'object' && typeof p.arm === 'string')) input.flagPlacements = placements
        else input.flagPlacementError = 'Placement lookup returned an invalid result.'
      }
      catch (cause) { input.flagPlacementError = failureDetail(cause) }
    }
    if (experiment.flagPoint) {
      // At most one row can be this experiment; two rows suffice to find a peer.
      const busy = await req.payload.find({ collection: 'xp-experiments', req, overrideAccess: false, depth: 0, limit: 2,
        where: { and: [{ flagPoint: { equals: experiment.flagPoint } }, { status: { in: ['running', 'decided'] } }] },
      })
      input.flagPointBusy = busy.docs.some(doc => String(doc.id) !== String(experiment.id))
    }
  }
  const layerId = relationshipId(experiment.layer)
  if (layerId !== undefined) {
    const layers = await req.payload.find({ collection: 'xp-layers', req, overrideAccess: false, depth: 0, limit: 1, where: { id: { equals: layerId } } })
    const layer = layers.docs[0]
    const usedSlices: number[] = []
    let page = 1
    while (true) {
      const result = await req.payload.find({ collection: 'xp-experiments', req, overrideAccess: false, depth: 0, limit: 100, page,
        where: { and: [{ layer: { equals: layerId } }, { status: { in: ['running', 'decided'] } }] },
      })
      for (const doc of result.docs) if (Array.isArray(doc.layerSlices)) usedSlices.push(...doc.layerSlices as number[])
      if (!result.hasNextPage) break
      page++
    }
    input.layer = layer ? { unitType: layer.unitType as 'user' | 'visitor', usedSlices } : null
  }
  return input
}

async function primaryHistory(source: MetricSource | undefined, now: Date) {
  if (!source) return null
  const from = new Date(now.getTime() - 28 * 86400000)
  try {
    const rows = await source.query({ from, to: now })
    const units = new Map<string, number>()
    const dailyUnits = new Set<string>()
    for (const row of rows) {
      if (!Number.isFinite(row.value) || !Number.isFinite(new Date(row.ts).getTime())) return null
      if (new Date(row.ts) < from || new Date(row.ts) >= now) continue
      units.set(row.unitId, (units.get(row.unitId) ?? 0) + row.value)
      dailyUnits.add(JSON.stringify([new Date(row.ts).toISOString().slice(0, 10), row.unitId]))
    }
    return { values: [...units.values()], dailyConverters: dailyUnits.size }
  } catch { return null }
}

export async function preflightData<TUser extends { id: DocId }>(req: PayloadRequest, { experimentId, options }: {
  experimentId: DocId; options: ResolvedOptions<TUser>
}, { now = new Date(), estimate = powerMetricWeeks }: PreflightDependencies = {}): Promise<PreflightResult | null> {
  const input = await loadStartInputs(req, options, experimentId)
  if (!input) return null
  const { experiment: e } = input
  const primaryId = relationshipId(e.metrics?.primary)
  const metric = input.metrics.find(metric => String(metric.id) === String(primaryId))
  const source = options.metricSources?.find(source => source.id === metric?.source)
  const historical = await primaryHistory(source, now)
  const history = historical?.values ?? null
  const reach = e.analysis?.reachPerDay
  const trafficPerDay = typeof reach === 'number' && Number.isFinite(reach) && reach > 0 ? reach : null
  const value = history === null ? null : source?.kind === 'binomial'
    ? trafficPerDay === null ? null : historical!.dailyConverters / 28 / trafficPerDay
    : history.length ? history.reduce((sum, value) => sum + value, 0) / history.length : 0
  // A rate of 1 or more means reachPerDay is below the converters; no honest baseline then.
  const baseline: PreflightResult['baseline'] = primaryId === undefined || value === null || source?.kind === 'binomial' && value >= 1 ? null : { metricId: primaryId, value, days: 28 }
  let power: PreflightResult['estimate'] = null
  if (trafficPerDay !== null && baseline && source && history) {
    const compared = e.arms.filter(arm => arm.kind !== 'holdout')
    const control = compared.find(arm => arm.kind === 'control')
    const variant = compared.find(arm => arm.kind === 'variant')
    const savedDuration = e.analysis?.plannedDurationDays && e.analysis.plannedDurationDays > 0 ? e.analysis.plannedDurationDays : undefined
    const planned = savedDuration ?? 14
    const enrolled = trafficPerDay * e.allocation / 100
    const pairShare = ((control?.weight ?? 0) + (variant?.weight ?? 0)) / 100
    const tuning = enrolled * planned * pairShare
    // Power's equal-arm model uses the smallest compared arm, so unequal weights
    // and holdout traffic never overstate the information in a comparison.
    const usersPerWeek = enrolled * 7 * Math.min(...compared.map(arm => arm.weight / 100)) * compared.length
    const n = Math.max(trafficPerDay * 28, history.length)
    const mean = history.reduce((sum, value) => sum + value, 0) / n
    const variance = history.reduce((sum, value) => sum + value * value, 0) / n - mean * mean
    const conversionRate = baseline.value
    // v1 planning assumption: 10% relative lift at 80% power, alpha fixed at 5%.
    const params: PowerMetricParams = source.kind === 'binomial'
      ? { type: 'binomial', conversionRate, effectSize: 0.1 }
      : { type: 'mean', mean, standardDeviation: Math.sqrt(Math.max(0, variance)), effectSize: 0.1 }
    if (control && variant && usersPerWeek > 0 && tuning > 0 && (source.kind !== 'binomial' || conversionRate > 0 && conversionRate < 1) && (source.kind === 'binomial' || mean > 0)) {
      try {
        const alpha = e.analysis?.method === 'bayesian' ? 0.05 : 0.05 / Math.max(1, compared.filter(arm => arm.kind === 'variant').length)
        const estimateAt = (sequentialTuningParameter: number) => estimate({ metrics: { primary: params }, nVariations: compared.length, nWeeks: 13, alpha, usersPerWeek, targetPower: 0.8,
          method: e.analysis?.method === 'bayesian' ? { type: 'bayesian' } : { type: 'frequentist', sequentialTesting: sequentialTuningParameter },
        })
        let result = await estimateAt(tuning)
        let weeks = result.sampleSizeAndRuntime.primary?.weeks ?? result.weekThreshold ?? 13
        const plannedDurationDays = savedDuration ?? Math.ceil(weeks * 7)
        const sequentialTuningParameter = enrolled * plannedDurationDays * pairShare
        if (savedDuration === undefined) {
          // Re-evaluate using exactly the duration and tuning Review will prefill.
          result = await estimateAt(sequentialTuningParameter)
          weeks = result.sampleSizeAndRuntime.primary?.weeks ?? result.weekThreshold ?? 13
        }
        power = { weeks, plannedDurationDays, sequentialTuningParameter,
          feasible: Number.isFinite(weeks) && weeks * 7 <= 90 && result.sampleSizeAndRuntime.primary !== undefined }
      } catch { /* An unavailable power estimate must not prevent Review. */ }
    }
  }
  const requiredSlots = e.arms.filter(arm => arm.kind !== 'holdout').map(arm => arm.slot)
  const placements: PreflightResult['placements'] = (input.placements ?? []).map(placement => ({
    collection: placement.collection, id: placement.id, title: placement.title,
    ok: requiredSlots.every(slot => slot && placement.slots[slot] > 0),
    detail: placement.published ? 'Published' : 'Draft',
  }))
  for (const placement of input.flagPlacements ?? []) placements.push({ collection: e.flagPoint ?? '', id: placement.arm, title: placement.arm, ok: placement.ok, ...(placement.detail ? { detail: placement.detail } : {}) })
  return { checks: checkStart(input), placements, baseline, trafficPerDay, estimate: power }
}
