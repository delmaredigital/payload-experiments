import { goalContent } from '../goals/fairness.js'
import { detached } from './placementInteractions.js'
import type { PayloadRequest } from 'payload'
import { lockAndRescanPlacements, placementInteractions } from './placementInteractions.js'
import { lockPagePaths } from '../db/locks.js'
import { lockMetricsForFreeze } from '../db/metricUsage.js'
import { DEFAULT_SEQUENTIAL_TUNING_PARAMETER } from '../constants.js'
import { claimSlices } from '../db/slices.js'
import { READINESS_COPY, asymmetricGoalsCopy, sameAddressCopy, interactingTestsCopy, pageInUseCopy, unpublishedPageCopy } from '../admin/copy/readiness.js'
import { GROUP_LABELS } from '../admin/copy/arms.js'
import { XpRefusal } from '../errors.js'
import { isOpValid } from '../targeting/ops.js'
import { newSeed } from '../runtime/seed.js'
import type { DocId, ResolvedOptions } from '../types/contracts.js'
import type { RefusalCode } from '../types/endpoints.js'
import { checkStart, pageTargetPaths, relationshipId, type StartExperiment } from './checkStart.js'
import { withTransition } from './kernel.js'
import { writePhaseRecord } from './phaseRecord.js'
import { loadPageTestsInUse, loadStartInputs, unpublishedPageTargets } from './preflightData.js'
import { resolveCaps, type MetricDefinition } from './resolveCaps.js'

export type TransitionExperiment = StartExperiment & Record<string, unknown> & {
  phase?: number; seed?: string; updatedAt?: string; layerSlices?: number[] | null
}
export async function readExperiment(req: PayloadRequest, id: DocId): Promise<TransitionExperiment> {
  // §7.8: internal lookup serves the authorised transition write. Preserve
  // admin-only analysis.method/kind for freezing; return access-filtered docs.
  const { docs } = await req.payload.find({ collection: 'xp-experiments', req, overrideAccess: true, depth: 0, limit: 1, where: { id: { equals: id } } })
  if (!docs[0]) throw new XpRefusal('not-found', 'Experiment not found', undefined, 404)
  return docs[0] as unknown as TransitionExperiment
}
export function refuse(code: RefusalCode, detail?: unknown): never {
  const messages: Partial<Record<RefusalCode, string>> = {
    'goal-in-some-versions': asymmetricGoalsCopy(detail),
    'placements-changed': "This test's pages changed while it was starting. Try again.",
    'page-busy': "One of this test's pages is being saved right now. Try again in a moment.",
    'interacting-tests': (() => { const d = (detail as Array<{ path: string; status: string; name: string; version: boolean }> | undefined)?.[0]; return d ? interactingTestsCopy(d.path, d.status, d.name, d.version) : 'Finish one of the tests first.' })(),
    'unknown-collection': "That page type isn't set up for tests.",
    'placement-removed': READINESS_COPY.placementRemoved,
    'page-in-use': pageInUseCopy((detail as { paths?: string[] } | undefined)?.paths?.[0] ?? 'this page'),
    'version-same-address': (() => { const d = detail as { arm: keyof typeof GROUP_LABELS; otherArm: keyof typeof GROUP_LABELS; path: string } | undefined; return sameAddressCopy(GROUP_LABELS[d?.arm ?? 'variantA'], GROUP_LABELS[d?.otherArm ?? 'control'], d?.path ?? 'this address') })(),
    'page-target-unpublished': unpublishedPageCopy(typeof detail === 'string' ? detail : 'This page'),
    'invalid-status': 'This action is not available in the current status.',
    'stale-draft': 'The experiment changed. Review it again before starting.',
    'flag-point-busy': 'Another experiment is running or decided on this flag point.',
    'layer-full': 'There is not enough room in this layer.',
    'allocation-lower': 'Allocation can only increase while running. Stop and start a new round to lower it.',
    'invalid-body': 'Check the experiment settings and try again.',
    'not-decided': 'This test has no standing winner.',
    'entry-not-found': 'That page is not in the report.',
    'entry-ok': 'That page was already updated.',
    'entry-dismissed': 'That page was already dismissed.',
    'entry-not-dismissed': 'That page is not dismissed.',
  }
  const conflict = ['page-busy', 'placements-changed', 'interacting-tests', 'invalid-status', 'stale-draft', 'page-in-use', 'flag-point-busy', 'layer-full', 'allocation-lower', 'not-decided', 'entry-ok', 'entry-dismissed', 'entry-not-dismissed'].includes(code)
  throw new XpRefusal(code, messages[code] ?? 'The experiment is not ready to start.', detail, code === 'entry-not-found' ? 404 : conflict ? 409 : 422)
}
export async function updateExperiment(req: PayloadRequest, id: DocId, data: Record<string, unknown>) {
  // §7.8: access-authorised transition writes locked plugin fields.
  await req.payload.update({ collection: 'xp-experiments', req, id, data, overrideAccess: true })
  const { docs } = await req.payload.find({ collection: 'xp-experiments', req, overrideAccess: false, depth: 0, limit: 1, where: { id: { equals: id } } })
  if (!docs[0]) throw new XpRefusal('not-found', 'Experiment not found', undefined, 404)
  return docs[0]
}

export async function start<TUser extends { id: DocId }>(req: PayloadRequest, { experimentId, options }: { experimentId: DocId; options: ResolvedOptions<TUser> }) {
  const input = await loadStartInputs(req, options, experimentId)
  if (!input) throw new XpRefusal('not-found', 'Experiment not found', undefined, 404)
  const full = await readExperiment(req, experimentId)
  if (full.updatedAt !== (input.experiment as TransitionExperiment).updatedAt) refuse('stale-draft')
  // Review reads respect field access; internal writes must preserve hidden config.
  input.experiment = { ...input.experiment, kind: full.kind, analysis: full.analysis }
  // Warning-only codes always have ok: true. These exclusions narrow
  // ReadinessCode to RefusalCode, which intentionally excludes warnings.
  const failed = checkStart(input).find(check => !check.ok)
  if (failed && failed.code !== 'page-targets-unchecked' && failed.code !== 'make-content-unsupported') refuse(failed.code, failed.detail)
  const before = input.experiment as TransitionExperiment
  const updatedAt = before.updatedAt
  const at = new Date()
  const caps = await resolveCaps(input.metrics as MetricDefinition[], options.metricSources ?? [], at)
  const { result: doc, revision } = await withTransition(req, {
    experimentId, layerId: relationshipId(before.layer), flagPointId: before.kind === 'flag' ? before.flagPoint : undefined,
  }, async ({ req, exec }) => {
    const current = await readExperiment(req, experimentId)
    if (current.updatedAt !== updatedAt) refuse('stale-draft')
    if (current.status !== 'draft' && current.status !== 'stopped') refuse('invalid-status')
    let placementDocs: import('../db/placements.js').PlacementDoc[] | undefined
    if (current.kind === 'block') {
      const rescan = await lockAndRescanPlacements(req, exec, options, current, input.placements ?? [])
      placementDocs = rescan.docs
      const failure = checkStart({ ...input, experiment: current, placements: rescan.placements }).find(check => !check.ok)
      if (failure && failure.code !== 'page-targets-unchecked' && failure.code !== 'make-content-unsupported') refuse(failure.code, failure.detail)
    }
    if (current.kind === 'page') {
      // Independent experiment/layer locks do not serialize overlapping pages.
      // Re-read occupancy after acquiring sorted path locks; hold through commit.
      // A waiting Start then sees the first Start's live test on this transaction.
      await lockPagePaths(exec, pageTargetPaths(current.arms))
      const recheck = checkStart({ ...input, experiment: current, pageTestsInUse: await loadPageTestsInUse(req) })
        .find(check => check.code === 'page-in-use' && !check.ok)
      if (recheck) refuse('page-in-use', recheck.detail)
      const conflicts = await placementInteractions(req, exec, options, current, pageTargetPaths(current.arms))
      if (conflicts.length) refuse('interacting-tests', conflicts)
      if (options.pages) {
        // The page guard takes the same path locks, so a delete, unpublish or rename that committed
        // while Start waited is visible now. Read it on a detached request (committed state, outside
        // this transaction): a refused host read must not kill the transition (CORE-21).
        // (the make-content pattern: drop the transaction id for the reads, restore it after).
        const transactionID = req.transactionID
        delete req.transactionID
        let unpublished: string[]
        try {
          unpublished = await unpublishedPageTargets(req, options, current)
        } finally { req.transactionID = transactionID }
        if (unpublished.length) refuse('page-target-unpublished', unpublished[0])
      }
    }
    if (current.kind === 'flag' && current.flagPoint) {
      const busy = await req.payload.find({ collection: 'xp-experiments', req, overrideAccess: false, depth: 0, limit: 2,
        where: { and: [{ flagPoint: { equals: current.flagPoint } }, { status: { in: ['running', 'decided'] } }] } })
      if (busy.docs.some(doc => String(doc.id) !== String(experimentId))) refuse('flag-point-busy')
      const point = options.flagPoints!.find(point => point.id === current.flagPoint)!
      const state = await req.payload.findGlobal({ slug: 'xp-state', req, overrideAccess: false, depth: 0 })
      const defaults = state.flagDefaults as Record<string, { params: Record<string, unknown> }> | undefined
      current.arms = current.arms.map(arm => arm.kind === 'control' ? { ...arm, params: defaults?.[point.id]?.params ?? point.defaultParams } : arm)
      const recheck = checkStart({ ...input, experiment: current }).find(check => !check.ok)
      if (recheck && recheck.code !== 'page-targets-unchecked' && recheck.code !== 'make-content-unsupported') refuse(recheck.code, recheck.detail)
    }
    if (input.metrics.some(metric => metric.source.startsWith('click:'))) {
      const content = await detached(req, () => goalContent(req, options, current, placementDocs))
      const failure = checkStart({ ...input, experiment: current, goalContent: content }).find(check => check.code === 'goal-in-some-versions' && !check.ok)
      if (failure) refuse('goal-in-some-versions', failure.detail)
    }
    const lockedMetrics = await lockMetricsForFreeze(exec, caps.definitions.map(metric => metric.id))
    if (!lockedMetrics) {
      throw new XpRefusal('stale-draft', 'A goal in this test was deleted. Review the goals before starting.', undefined, 409)
    }
    // Reachable: a slug/source change takes FOR NO KEY UPDATE, which a draft's FK check does not wait on.
    if (caps.definitions.some(metric => {
      const locked = lockedMetrics.find(row => String(row.id) === String(metric.id))!
      return locked.slug !== metric.slug || locked.source !== metric.source
    })) throw new XpRefusal('stale-draft', 'A goal changed. Review it again before starting.', undefined, 409)
    const targeting = (current.targeting ?? []).map(rule => {
      const type = Object.hasOwn(options.attributeKeys ?? {}, rule.attribute) ? options.attributeKeys![rule.attribute]!.type : undefined
      const validValue = type === 'string' && ['in', 'nin'].includes(rule.op)
        ? Array.isArray(rule.value) && rule.value.length > 0 && rule.value.every(value => typeof value === 'string')
        : typeof rule.value === type && (type !== 'number' || Number.isFinite(rule.value))
      if (!type) refuse('undeclared-targeting-key', { attribute: rule.attribute })
      if (!isOpValid(type, rule.op) || !validValue) refuse('invalid-targeting-rule', { attribute: rule.attribute })
      return { ...rule, type }
    })
    const layerId = relationshipId(current.layer)
    const layerSlices = layerId === undefined ? [] : await claimSlices(exec, { layerId, experimentId, count: current.allocation })
    const phase = (current.phase ?? 0) + 1
    const seed = newSeed()
    const startedAt = at.toISOString()
    const definitions = caps.definitions.map(metric => ({ ...metric, metricId: metric.id, addedAt: startedAt,
      role: String(relationshipId(current.metrics?.primary)) === String(metric.id) ? 'primary'
        : current.metrics?.guardrails?.some(id => String(relationshipId(id)) === String(metric.id)) ? 'guardrail' : 'secondary',
    }))
    await writePhaseRecord(req, { experiment: experimentId, phase, phaseKind: 'test', seed, startedAt, arms: current.arms,
      allocation: current.allocation, allocationChanges: [], targeting, metricDefinitions: definitions, ...(placementDocs ? { placementDocs } : {}),
      analysis: { ...current.analysis, method: current.analysis?.method ?? 'sequential', alpha: 0.05,
        sequentialTuningParameter: current.analysis?.sequentialTuningParameter ?? DEFAULT_SEQUENTIAL_TUNING_PARAMETER,
        cupedLookbackDays: 14, layerSlices,
        minSampleSizes: Object.fromEntries(definitions.map(metric => [metric.id, metric.minSampleSize ?? 150])),
        guardrailThresholds: Object.fromEntries(definitions.filter(metric => metric.role === 'guardrail').map(metric => [metric.id, metric.guardrailThreshold ?? 0.05])),
        bayesian: { ctw: 0.95, risk: 0.0125 },
      }, contentChanges: [],
    })
    return updateExperiment(req, experimentId, { status: 'running', phase, seed, startedAt, stoppedAt: null, layerSlices, arms: current.arms })
  })
  return { doc, revision: revision!, ...(caps.detail.length ? { detail: caps.detail } : {}) }
}
