import type { PayloadRequest } from 'payload'
import { claimSlices } from '../db/slices.js'
import { XpRefusal } from '../errors.js'
import { isOpValid } from '../targeting/ops.js'
import { newSeed } from '../runtime/seed.js'
import type { DocId, ResolvedOptions } from '../types/contracts.js'
import type { RefusalCode } from '../types/endpoints.js'
import { checkStart, relationshipId, type StartExperiment } from './checkStart.js'
import { withTransition } from './kernel.js'
import { writePhaseRecord } from './phaseRecord.js'
import { loadStartInputs } from './preflightData.js'
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
    'invalid-status': 'This action is not available in the current status.',
    'stale-draft': 'The experiment changed. Review it again before starting.',
    'flag-point-busy': 'Another experiment is running or decided on this flag point.',
    'layer-full': 'There is not enough room in this layer.',
    'allocation-lower': 'Allocation can only increase while running. Stop and start a new round to lower it.',
    'invalid-body': 'Check the experiment settings and try again.',
  }
  const conflict = ['invalid-status', 'stale-draft', 'flag-point-busy', 'layer-full', 'allocation-lower'].includes(code)
  throw new XpRefusal(code, messages[code] ?? 'The experiment is not ready to start.', detail, conflict ? 409 : 422)
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
  const failed = checkStart(input).find(check => !check.ok)
  if (failed) refuse(failed.code, failed.detail)
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
    if (current.kind === 'flag' && current.flagPoint) {
      const busy = await req.payload.find({ collection: 'xp-experiments', req, overrideAccess: false, depth: 0, limit: 2,
        where: { and: [{ flagPoint: { equals: current.flagPoint } }, { status: { in: ['running', 'decided'] } }] } })
      if (busy.docs.some(doc => String(doc.id) !== String(experimentId))) refuse('flag-point-busy')
      const point = options.flagPoints!.find(point => point.id === current.flagPoint)!
      const state = await req.payload.findGlobal({ slug: 'xp-state', req, overrideAccess: false, depth: 0 })
      const defaults = state.flagDefaults as Record<string, { params: Record<string, unknown> }> | undefined
      current.arms = current.arms.map(arm => arm.kind === 'control' ? { ...arm, params: defaults?.[point.id]?.params ?? point.defaultParams } : arm)
      const recheck = checkStart({ ...input, experiment: current }).find(check => !check.ok)
      if (recheck) refuse(recheck.code, recheck.detail)
    }
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
      allocation: current.allocation, allocationChanges: [], targeting, metricDefinitions: definitions,
      analysis: { ...current.analysis, method: current.analysis?.method ?? 'sequential', alpha: 0.05,
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
