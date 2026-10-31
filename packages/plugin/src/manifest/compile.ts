import type { PayloadRequest } from 'payload'
import type { Arm, DocId, ExperimentKind, ExposurePolicy, Status, TargetingRule, UnitType } from '../types/contracts.js'
import type { Manifest, ManifestExperiment } from '../types/manifest.js'
import { txExecutor } from '../db/executor.js'
import { bumpRevision, writeManifest } from '../db/state.js'

export interface ManifestPhase {
  phase: number; phaseKind: 'test' | 'rollout'; seed: string; arms: Arm[]
  allocation: number; targeting: TargetingRule[]; endedAt?: string | null
}
export interface ManifestInputExperiment {
  id: DocId; slug: string; kind: ExperimentKind; status: Status; unitType: UnitType
  exposurePolicy: ExposurePolicy; flagPoint?: string | null; arms: Arm[]
  layer?: { slug: string } | DocId | null; layerSlices?: number[] | null
  decision?: { winnerArm?: string | null; discardedAt?: string | null; holdoutReleasedAt?: string | null } | null
  currentPhase: ManifestPhase | null
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
    // §7.8 manifest reads: current immutable phase, never editable live config.
    const phases = await req.payload.find({
      collection: 'xp-phases', req, overrideAccess: true, depth: 0, limit: 1,
      where: { experiment: { equals: doc.id } }, sort: '-phase',
    })
    experiments.push({ ...doc, currentPhase: phases.docs[0] ?? null } as unknown as ManifestInputExperiment)
  }
  // §7.8 manifest reads: defaults are part of the private compiled manifest.
  const state = await req.payload.findGlobal({ slug: 'xp-state', req, overrideAccess: true, depth: 0 })
  return { experiments, flagDefaults: (state.flagDefaults ?? {}) as Manifest['flagDefaults'], excludeIds }
}

/** Pure compiler. Assignment config comes exclusively from the frozen phase. */
export function compileManifest(inputs: ManifestInputs, revision: number): Manifest {
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
      const winner = experiment.arms.find(arm => arm.key === decision.winnerArm)
      if (experiment.kind === 'block' && winner?.slot) manifest.archivedWinners[experiment.slug] = winner.slot
      if (experiment.kind === 'page' && winner?.pageTarget) {
        for (const arm of experiment.arms) {
          if (arm.pageTarget && arm.pageTarget !== winner.pageTarget) {
            manifest.archivedPages[arm.pageTarget] = { slug: experiment.slug, winnerPath: winner.pageTarget }
          }
        }
      }
      continue
    }
    if (experiment.status !== 'running' && experiment.status !== 'decided') continue
    if (!phase) throw new Error(`Missing current phase for experiment ${experiment.slug}`)
    const rollout = experiment.status === 'decided' && phase.phaseKind === 'rollout' && !phase.endedAt && !decision?.holdoutReleasedAt
    const layer = (experiment.status === 'running' || rollout) && experiment.layer && typeof experiment.layer === 'object'
      ? { slug: experiment.layer.slug, slices: experiment.layerSlices ?? [] } : undefined
    const compiled: ManifestExperiment = {
      id: experiment.id, slug: experiment.slug, kind: experiment.kind, unitType: experiment.unitType,
      status: experiment.status, phase: phase.phase, phaseKind: rollout ? 'rollout' : 'test', seed: phase.seed,
      coverage: layer ? 1 : phase.allocation / 100,
      arms: phase.arms.map(({ key, kind, weight, slot, pageTarget, params }) => ({
        key, kind, weight, ...(slot != null ? { slot } : {}), ...(pageTarget != null ? { pageTarget } : {}), ...(params != null ? { params } : {}),
      })),
      targeting: phase.targeting ?? [], exposurePolicy: experiment.exposurePolicy,
      deferrable: (phase.targeting ?? []).some(rule => rule.attribute === 'loggedIn' || rule.attribute === 'staff'),
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

export async function buildAndStoreManifest(req: PayloadRequest, options: { excludeIds?: DocId[] } = {}): Promise<Manifest> {
  const inputs = await loadManifestInputs(req, options)
  const exec = txExecutor(req)
  const revision = await bumpRevision(exec)
  const manifest = compileManifest(inputs, revision)
  await writeManifest(exec, manifest)
  return manifest
}
