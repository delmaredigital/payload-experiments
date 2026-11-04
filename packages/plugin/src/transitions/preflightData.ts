import { Forbidden, NotFound, type PayloadRequest } from 'payload'
import { safeError } from '../log.js'
import { powerMetricWeeks } from '@delmaredigital/experiments-stats'
import type { PowerMetricParams, PowerWeeksInput, PowerWeeksResult } from '@delmaredigital/experiments-stats'
import type { DocId, MetricSource, ResolvedOptions } from '../types/contracts.js'
import type { PreflightResult } from '../types/endpoints.js'
import { checkStart, relationshipId } from './checkStart.js'
import type { CheckStartInput, PlacementFailure, StartExperiment, StartMetric } from './checkStart.js'
import { flagPlacements, scanBlockPlacements, type BlockPlacement } from './placements.js'

export interface PreflightDependencies {
  now?: Date
  estimate?: (input: PowerWeeksInput) => PowerWeeksResult | Promise<PowerWeeksResult>
}
const failureDetail = (cause: unknown): PlacementFailure => {
  const name = cause instanceof Error ? cause.name : undefined
  return cause instanceof Forbidden || name === 'Forbidden' ? 'forbidden'
    : cause instanceof NotFound || name === 'NotFound' ? 'not-found' : 'placements-failed'
}

/** Read-only inputs shared with Start's pre-transaction checks. Start must re-read
 * the document and lock-sensitive facts inside its transition (CORE-10b).
 */
export async function loadStartInputs<TUser extends { id: DocId }>(req: PayloadRequest, options: ResolvedOptions<TUser>, experimentId: DocId): Promise<CheckStartInput | null> {
  const found = await req.payload.find({ collection: 'xp-experiments', req, overrideAccess: false, depth: 0, limit: 1, where: { id: { equals: experimentId } } })
  if (!found.docs[0]) return null
  const experiment = found.docs[0] as unknown as StartExperiment
  return (await loadStartInputsBatch(req, options, [experiment])).get(String(experiment.id)) ?? null
}

/** Access-checked occupancy, shared by preflight and Start's locked recheck. */
export async function loadPageTestsInUse(req: PayloadRequest): Promise<NonNullable<CheckStartInput['pageTestsInUse']>> {
  const tests: NonNullable<CheckStartInput['pageTestsInUse']> = []
  let page = 1
  while (true) {
    const result = await req.payload.find({ collection: 'xp-experiments', req, overrideAccess: false, depth: 0, limit: 100, page,
      where: { and: [{ kind: { equals: 'page' } }, { status: { in: ['running', 'decided'] } }] } })
    tests.push(...result.docs as unknown as NonNullable<CheckStartInput['pageTestsInUse']>)
    if (!result.hasNextPage) return tests
    page++
  }
}

const metricIds = (experiment: StartExperiment) => [experiment.metrics?.primary, ...experiment.metrics?.secondary ?? [], ...experiment.metrics?.guardrails ?? []]
  .map(relationshipId).filter((id): id is DocId => id !== undefined)

/** Shared, request-scoped reads for summary; a failed row is null in tolerant mode.
 * Preflight/Start use the same builder and retain their throwing read behaviour.
 */
export async function loadStartInputsBatch<TUser extends { id: DocId }>(req: PayloadRequest, options: ResolvedOptions<TUser>, experiments: StartExperiment[], tolerateErrors = false): Promise<Map<string, CheckStartInput | null>> {
  const ids = [...new Set(experiments.flatMap(metricIds))]
  const metrics = (async () => {
    if (!ids.length) return [] as StartMetric[]
    const result = await req.payload.find({ collection: 'xp-metrics', req, overrideAccess: false, depth: 0, pagination: false, limit: ids.length, where: { id: { in: ids } } })
    return result.docs as unknown as StartMetric[]
  })()
  const blockSlugs = new Set(experiments.filter(e => e.kind === 'block').map(e => e.slug))
  // Lazy promises prevent unhandled rejections and share failed reads as well as successful ones.
  let pageTestsInUse: ReturnType<typeof loadPageTestsInUse> | undefined
  let blocks: ReturnType<typeof scanBlockPlacements> | undefined
  let state: Promise<Record<string, { params: Record<string, unknown> }> | undefined> | undefined
  const busyPoints = new Map<string, Promise<Array<{ id: DocId }>>>()
  const layers = new Map<string, Promise<CheckStartInput['layer']>>()
  const inputs = new Map<string, CheckStartInput | null>()
  for (const experiment of experiments) {
    try {
      const ownIds = new Set(metricIds(experiment).map(String))
      const input: CheckStartInput = { experiment, metrics: (await metrics).filter(metric => ownIds.has(String(metric.id))), metricSources: options.metricSources, flagPoints: options.flagPoints, attributeKeys: options.attributeKeys }
      const placementFailure = (cause: unknown): PlacementFailure => {
        const collection = experiment.flagPoint ?? 'xp-experiments'
        req.payload.logger.error({ err: safeError(cause), experimentId: experiment.id, collection, id: experiment.id }, 'Experiment placement lookup failed')
        return failureDetail(cause)
      }
      if (experiment.kind === 'page') {
        pageTestsInUse ??= loadPageTestsInUse(req)
        input.pageTestsInUse = await pageTestsInUse
        input.pageTargetsUnchecked = options.pages === undefined
        if (options.pages) {
          input.unpublishedPageTargets = []
          for (const arm of experiment.arms.filter(arm => arm.kind !== 'holdout' && arm.pageTarget?.trim())) {
            let published = false
            for (const collection of options.pages.collections) {
              try {
                const page = await collection.findByPath(arm.pageTarget!, req)
                if (page?.published === true) published = true
              } catch (cause) {
                req.payload.logger.error({ err: safeError(cause), experimentId: experiment.id, collection: collection.slug, id: arm.pageTarget }, 'Experiment page lookup failed')
              }
            }
            if (!published) input.unpublishedPageTargets.push(arm.pageTarget!)
          }
        }
      }
      if (experiment.kind === 'block') {
        try {
          blocks ??= scanBlockPlacements(req, { slugs: blockSlugs, puckCollections: options.puck?.collections ?? [] })
          input.placements = (await blocks).get(experiment.slug) ?? []
        } catch (cause) { input.placementError = placementFailure(cause) }
      }
      if (experiment.kind === 'flag') {
        const point = options.flagPoints?.find(point => point.id === experiment.flagPoint)
        if (point) {
          state ??= (async () => {
            try {
              const doc = await req.payload.findGlobal({ slug: 'xp-state', req, overrideAccess: false, depth: 0 })
              return doc.flagDefaults as Record<string, { params: Record<string, unknown> }> | undefined
            } catch (cause) {
              const error = cause as { status?: unknown; name?: unknown } | null
              if (error?.status !== 403 && error?.name !== 'Forbidden') throw cause
              // Match the existing preflight fallback when the global is access-filtered.
              return undefined
            }
          })()
          const defaults = await state
          experiment.arms = experiment.arms.map(arm => arm.kind === 'control' ? { ...arm, params: defaults?.[point.id]?.params ?? point.defaultParams } : arm)
        }
        if (point?.placements) {
          try {
            const placements = await flagPlacements(options, experiment, req)
            if (Array.isArray(placements) && placements.every(p => p && typeof p === 'object' && typeof p.arm === 'string')) input.flagPlacements = placements
            else input.flagPlacementError = placementFailure(new Error('Invalid placement result'))
          } catch (cause) { input.flagPlacementError = placementFailure(cause) }
        }
        if (experiment.flagPoint) {
          const key = experiment.flagPoint
          if (!busyPoints.has(key)) busyPoints.set(key, (async () => {
            // Two rows suffice to find a peer, including when the batch contains that peer.
            const busy = await req.payload.find({ collection: 'xp-experiments', req, overrideAccess: false, depth: 0, limit: 2,
              where: { and: [{ flagPoint: { equals: key } }, { status: { in: ['running', 'decided'] } }] } })
            return busy.docs
          })())
          input.flagPointBusy = (await busyPoints.get(key)!).some(doc => String(doc.id) !== String(experiment.id))
        }
      }
      const layerId = relationshipId(experiment.layer)
      if (layerId !== undefined) {
        const key = String(layerId)
        if (!layers.has(key)) layers.set(key, (async () => {
          const result = await req.payload.find({ collection: 'xp-layers', req, overrideAccess: false, depth: 0, limit: 1, where: { id: { equals: layerId } } })
          const layer = result.docs[0]
          const usedSlices: number[] = []
          let page = 1
          while (true) {
            const usage = await req.payload.find({ collection: 'xp-experiments', req, overrideAccess: false, depth: 0, limit: 100, page,
              where: { and: [{ layer: { equals: layerId } }, { status: { in: ['running', 'decided'] } }] } })
            for (const doc of usage.docs) if (Array.isArray(doc.layerSlices)) usedSlices.push(...doc.layerSlices as number[])
            if (!usage.hasNextPage) break
            page++
          }
          return layer ? { unitType: layer.unitType as 'user' | 'visitor', usedSlices } : null
        })())
        input.layer = await layers.get(key)!
      }
      inputs.set(String(experiment.id), input)
    } catch (cause) {
      if (!tolerateErrors) throw cause
      inputs.set(String(experiment.id), null)
    }
  }
  return inputs
}

// Bound each optional host preview lookup so it cannot indefinitely hold preflight open.
const PREVIEW_URL_TIMEOUT_MS = 2000
// Resolve host preview lookups in a bounded pool instead of launching one per slot.
const PREVIEW_URL_CONCURRENCY = 8

async function placementUrls<TUser extends { id: DocId }>(options: ResolvedOptions<TUser>, placement: BlockPlacement, pendingPreviews: { count: number }, onFailure: (cause: unknown, placement: BlockPlacement) => void,
  previews: Map<string, Promise<string | undefined>>): Promise<Pick<PreflightResult['placements'][number], 'url' | 'editorUrl'>> {
  const result: Pick<PreflightResult['placements'][number], 'url' | 'editorUrl'> = {}
  const { collection, id, published } = placement
  // One host lookup per page version: several slots on a page share it.
  const key = JSON.stringify([collection, String(id), published])
  let preview = previews.get(key)
  if (!preview) previews.set(key, preview = previewLookup(options, placement, pendingPreviews, onFailure))
  const url = await preview
  if (url !== undefined) result.url = url
  try {
    const url = options.admin?.editorUrl?.({ collection, id, draft: !published })
    if (typeof url === 'string') result.editorUrl = url
  } catch { /* Keep the client's default editor link available. */ }
  return result
}

async function previewLookup<TUser extends { id: DocId }>(options: ResolvedOptions<TUser>, placement: BlockPlacement, pendingPreviews: { count: number }, onFailure: (cause: unknown, placement: BlockPlacement) => void): Promise<string | undefined> {
  const { collection, id, title, published, slug } = placement
  const previewUrl = options.admin?.previewUrl
  let found: string | undefined
  if (previewUrl) {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      if (pendingPreviews.count >= PREVIEW_URL_CONCURRENCY) throw new Error('Preview URL lookups at capacity')
      pendingPreviews.count++
      // A timeout cannot cancel host work: retain its permit until that work settles.
      const lookup = Promise.resolve()
        .then(() => previewUrl({ collection, id, title, published, ...(slug !== undefined ? { slug } : {}) }))
        .finally(() => { pendingPreviews.count-- })
      const url = await Promise.race([
        lookup,
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Preview URL lookup timed out')), PREVIEW_URL_TIMEOUT_MS) }),
      ])
      if (typeof url === 'string') found = url
      else if (url !== null && url !== undefined) throw new TypeError('Invalid preview URL result')
    } catch (cause) { onFailure(cause, placement) }
    finally { clearTimeout(timer) }
  }
  return found
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
    const planned = 14
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
        const plannedDurationDays = Math.ceil(weeks * 7)
        const sequentialTuningParameter = enrolled * plannedDurationDays * pairShare
        // Re-evaluate using exactly the power-derived duration and tuning Apply will save.
        result = await estimateAt(sequentialTuningParameter)
        weeks = result.sampleSizeAndRuntime.primary?.weeks ?? result.weekThreshold ?? 13
        power = { weeks, plannedDurationDays, sequentialTuningParameter,
          feasible: Number.isFinite(weeks) && weeks * 7 <= 90 && result.sampleSizeAndRuntime.primary !== undefined }
      } catch { /* An unavailable power estimate must not prevent Review. */ }
    }
  }
  const requiredSlots = e.arms.filter(arm => arm.kind !== 'holdout').map(arm => arm.slot)
  const blocks = input.placements ?? []
  const placements: PreflightResult['placements'] = new Array(blocks.length)
  let nextPlacement = 0
  const pendingPreviews = { count: 0 }
  const previews = new Map<string, Promise<string | undefined>>()
  let loggedPreviewFailure = false
  const onPreviewFailure = (cause: unknown, placement: BlockPlacement) => {
    if (loggedPreviewFailure) return
    loggedPreviewFailure = true
    req.payload.logger.warn({ err: safeError(cause), experimentId: e.id, collection: placement.collection, id: placement.id }, 'Experiment preview URL lookup failed')
  }
  await Promise.all(Array.from({ length: Math.min(PREVIEW_URL_CONCURRENCY, blocks.length) }, async () => {
    while (nextPlacement < blocks.length) {
      const index = nextPlacement++
      const placement = blocks[index]!
      placements[index] = {
        collection: placement.collection, id: placement.id, title: placement.title, slots: placement.slots,
        ...await placementUrls(options, placement, pendingPreviews, onPreviewFailure, previews),
        ok: requiredSlots.every(slot => slot && placement.slots[slot] > 0),
        detail: placement.published ? 'Published' : 'Draft',
      }
    }
  }))
  for (const placement of input.flagPlacements ?? []) placements.push({ collection: e.flagPoint ?? '', id: placement.arm, title: placement.arm, ok: placement.ok, ...(placement.detail ? { detail: placement.detail } : {}) })
  return { checks: checkStart(input), placements, baseline, trafficPerDay, estimate: power }
}
