import type { PayloadRequest } from 'payload'
import type { Arm, DocId, ExperimentKind, ExposurePolicy, Status, TargetingRule, UnitType } from '../types/contracts.js'
import type { Manifest, ManifestExperiment } from '../types/manifest.js'
import { txExecutor } from '../db/executor.js'
import { bumpRevision, writeManifest } from '../db/state.js'
import { XpRefusal } from '../errors.js'
import { xpOptionsFromReq } from '../options/fromReq.js'
import type { AttributeKeys } from '../runtime/targeting.js'

type TypedTargetingRule = ManifestExperiment['targeting'][number]
export interface ManifestCompileOptions {
  attributeKeys?: AttributeKeys
  onInvalid?(slug: string, reason: string): void
}

export interface ManifestPhase {
  phase: number; phaseKind: 'test' | 'rollout'; seed: string; arms: Arm[]
  allocation: number; targeting: Array<TargetingRule & { type?: TypedTargetingRule['type'] }>; endedAt?: string | null
}
export interface ManifestInputExperiment {
  id: DocId; slug: string; kind: ExperimentKind; status: Status; unitType: UnitType
  exposurePolicy: ExposurePolicy; flagPoint?: string | null; arms: Arm[]
  layer?: { slug: string } | DocId | null; layerSlices?: number[] | null
  decision?: { winnerArm?: string | null; discardedAt?: string | null; holdoutReleasedAt?: string | null } | null
  currentPhase: ManifestPhase | null
  lastTestPhase?: ManifestPhase | null
}
export interface ManifestInputs {
  experiments: ManifestInputExperiment[]
  flagDefaults: Manifest['flagDefaults']
  excludeIds?: DocId[]
}

export async function loadManifestInputs(req: PayloadRequest, { excludeIds = [] }: { excludeIds?: DocId[] } = {}): Promise<ManifestInputs> {
  // §7.8 manifest reads: transitions compile all live/archived routing state.
  const result = await req.payload.find({
    collection: 'xp-experiments', req, overrideAccess: true, depth: 1, limit: 0,
    where: { status: { in: ['running', 'decided', 'archived'] } },
  })
  const excluded = new Set(excludeIds.map(String))
  const experiments: ManifestInputExperiment[] = []
  for (const doc of result.docs) {
    if (excluded.has(String(doc.id))) continue
    // §7.8 manifest reads: archived routing needs all arms from the last test,
    // while active assignment uses the current immutable phase.
    const phases = await req.payload.find({
      collection: 'xp-phases', req, overrideAccess: true, depth: 0, limit: 1,
      where: { experiment: { equals: doc.id }, ...(doc.status === 'archived' ? { phaseKind: { equals: 'test' } } : {}) }, sort: '-phase',
    })
    const rollout = phases.docs[0]?.phaseKind === 'rollout'
    // §7.8 manifest reads: runtime rollout ranges use the test's full weights (including their exact
    // floating-point sum) and its control content. The rollout record has only
    // winner + holdout; never reconstruct the holdout boundary from those weights.
    const test = rollout ? await req.payload.find({
      collection: 'xp-phases', req, overrideAccess: true, depth: 0, limit: 1,
      where: { experiment: { equals: doc.id }, phaseKind: { equals: 'test' } }, sort: '-phase',
    }) : null
    if (rollout && !test?.docs[0]) throw new Error('Missing test phase for rollout ' + doc.id)
    experiments.push({ ...doc, currentPhase: doc.status === 'archived' ? null : phases.docs[0] ?? null,
      ...(doc.status === 'archived' ? { lastTestPhase: phases.docs[0] ?? null } : {}),
      ...(rollout ? { lastTestPhase: test!.docs[0] } : {}),
    } as unknown as ManifestInputExperiment)
  }
  // §7.8 manifest reads: defaults are part of the private compiled manifest.
  const state = await req.payload.findGlobal({ slug: 'xp-state', req, overrideAccess: true, depth: 0 })
  return { experiments, flagDefaults: (state.flagDefaults ?? {}) as Manifest['flagDefaults'], excludeIds }
}

/** The builder has already acquired the state lock with bumpRevision. */
async function pruneDeletedDefaults(req: PayloadRequest, inputs: ManifestInputs): Promise<void> {
  if (!inputs.excludeIds?.length) return
  const excluded = new Set(inputs.excludeIds.map(String))
  const defaults = Object.fromEntries(Object.entries(inputs.flagDefaults).filter(([, value]) => !excluded.has(String(value.experiment))))
  if (Object.keys(defaults).length === Object.keys(inputs.flagDefaults).length) return
  // §7.8 transition write: keep delete exclusions durable under the state
  // lock, so a later unrelated compilation cannot restore deleted defaults.
  await req.payload.updateGlobal({ slug: 'xp-state', req, overrideAccess: true, data: { flagDefaults: defaults } })
  inputs.flagDefaults = defaults
}

/** Pure compiler. Assignment config comes exclusively from the frozen phase. */
export function compileManifest(inputs: ManifestInputs, revision: number, { attributeKeys, onInvalid }: ManifestCompileOptions = {}): Manifest {
  const excluded = new Set(inputs.excludeIds?.map(String))
  const manifest: Manifest = { v: 1, revision, experiments: [], flagDefaults: {}, archivedWinners: {}, archivedPages: {} }
  for (const [point, value] of Object.entries(inputs.flagDefaults)) {
    if (!excluded.has(String(value.experiment))) manifest.flagDefaults[point] = structuredClone(value)
  }
  for (const experiment of inputs.experiments) {
    if (excluded.has(String(experiment.id))) continue
    const { decision, currentPhase: phase } = experiment
    if (experiment.status === 'archived') {
      if (!decision?.winnerArm || decision.discardedAt) continue
      const testPhase = experiment.lastTestPhase ?? (phase?.phaseKind === 'test' ? phase : null)
      if (!testPhase) throw new XpRefusal('invalid-status', `Missing last test phase for experiment ${experiment.slug}`, undefined, 409)
      const winner = testPhase.arms.find(arm => arm.key === decision.winnerArm)
      if (experiment.kind === 'block' && winner?.slot) manifest.archivedWinners[experiment.slug] = winner.slot
      if (experiment.kind === 'page' && winner?.pageTarget) {
        for (const arm of testPhase.arms) {
          if (arm.pageTarget && arm.pageTarget !== winner.pageTarget) {
            manifest.archivedPages[arm.pageTarget] = { slug: experiment.slug, winnerPath: winner.pageTarget }
          }
        }
      }
      continue
    }
    if (experiment.status !== 'running' && experiment.status !== 'decided') continue
    if (!phase) throw new Error(`Missing current phase for experiment ${experiment.slug}`)
    const targeting: TypedTargetingRule[] = []
    for (const rule of phase.targeting ?? []) {
      // Legacy phases have no stored type. Only those consult today's registry.
      const type = rule.type ?? (attributeKeys && Object.hasOwn(attributeKeys, rule.attribute) ? attributeKeys[rule.attribute]?.type : undefined)
      if (type !== 'string' && type !== 'number' && type !== 'boolean') break
      targeting.push({ attribute: rule.attribute, op: rule.op, value: rule.value, type })
    }
    if (targeting.length !== (phase.targeting ?? []).length) {
      onInvalid?.(experiment.slug, 'untyped-targeting-rule')
      continue
    }
    const rollout = experiment.status === 'decided' && phase.phaseKind === 'rollout' && !phase.endedAt && !decision?.holdoutReleasedAt
    let layer: ManifestExperiment['layer']
    if ((experiment.status === 'running' || rollout) && experiment.layer != null) {
      if (typeof experiment.layer !== 'object' || typeof experiment.layer.slug !== 'string' || !experiment.layer.slug || !Array.isArray(experiment.layerSlices)) {
        throw new XpRefusal('invalid-status', `Incomplete layer configuration for experiment ${experiment.slug}`, undefined, 409)
      }
      layer = { slug: experiment.layer.slug, slices: experiment.layerSlices }
    }
    const compiled: ManifestExperiment = {
      id: experiment.id, slug: experiment.slug, kind: experiment.kind, unitType: experiment.unitType,
      status: experiment.status, phase: phase.phase, phaseKind: rollout ? 'rollout' : 'test', seed: phase.seed,
      coverage: layer || (experiment.status === 'decided' && !rollout) ? 1 : phase.allocation / 100,
      arms: (phase.phaseKind === 'rollout' ? experiment.lastTestPhase?.arms ?? phase.arms : phase.arms).map(({ key, kind, weight, slot, pageTarget, params }) => ({
        key, kind, weight, ...(slot != null ? { slot } : {}), ...(pageTarget != null ? { pageTarget } : {}), ...(params != null ? { params } : {}),
      })),
      targeting, exposurePolicy: experiment.exposurePolicy,
      deferrable: targeting.some(rule => rule.attribute === 'loggedIn' || rule.attribute === 'staff'),
      ...(experiment.flagPoint ? { flagPoint: experiment.flagPoint } : {}),
      ...(layer ? { layer } : {}),
      ...(decision?.winnerArm ? { winnerArm: decision.winnerArm } : {}),
    }
    if (rollout) {
      const holdout = phase.arms.find(arm => arm.kind === 'holdout')
      if (holdout) compiled.holdoutKey = holdout.key
    }
    manifest.experiments.push(structuredClone(compiled))
  }
  return manifest
}

/** Take the state lock before reading inputs. Under READ COMMITTED, a builder
 * waiting for another transition then sees that transition's committed changes,
 * so a later revision cannot overwrite the manifest with pre-lock input state.
 * All reads and writes join the request's transaction.
 */
export async function buildAndStoreManifest(req: PayloadRequest, options: { excludeIds?: DocId[] } = {}): Promise<Manifest> {
  const exec = txExecutor(req)
  const revision = await bumpRevision(exec)
  const inputs = await loadManifestInputs(req, options)
  await pruneDeletedDefaults(req, inputs)
  const manifest = compileManifest(inputs, revision, {
    attributeKeys: xpOptionsFromReq(req).attributeKeys,
    onInvalid: (slug, reason) => req.payload.logger.warn({ slug, reason }, 'Experiment omitted from manifest'),
  })
  await writeManifest(exec, manifest)
  return manifest
}
