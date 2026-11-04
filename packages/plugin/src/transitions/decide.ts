import type { PayloadRequest } from 'payload'
import { DEFAULT_SEQUENTIAL_TUNING_PARAMETER } from '../constants.js'
import { reclaimSlices } from '../db/slices.js'
import { decideGuard } from '../results/decideGuard.js'
import type { Arm, DocId } from '../types/contracts.js'
import type { DecideBody } from '../types/endpoints.js'
import type { Snapshot } from '../types/snapshot.js'
import { lockPagePaths } from '../db/locks.js'
import { routedPageTests } from '../db/pageOccupancy.js'
import { pageTargetPaths, relationshipId } from './checkStart.js'
import { expectedConfirm, matchesConfirm, storedWinnerLabel } from './confirmPhrases.js'
import { withTransition } from './kernel.js'
import { readPhaseRecord, setPhaseEndedAt, writePhaseRecord } from './phaseRecord.js'
import { readExperiment, refuse, updateExperiment } from './start.js'

export async function decide(req: PayloadRequest, { experimentId, winnerArm, note, confirmation }: DecideBody & { experimentId: DocId }) {
  const before = await readExperiment(req, experimentId)
  const { result: doc, revision } = await withTransition(req, {
    experimentId, layerId: relationshipId(before.layer), flagPointId: before.kind === 'flag' ? before.flagPoint : undefined,
  }, async ({ req, exec }) => {
    const current = await readExperiment(req, experimentId)
    if (current.status !== 'running' && current.status !== 'stopped') refuse('invalid-status')
    if (current.kind === 'flag' && current.flagPoint) {
      // §7.8: recheck point occupancy under its lock before restoring live routing.
      const busy = await req.payload.find({ collection: 'xp-experiments', req, overrideAccess: true, depth: 0, limit: 0,
        where: { and: [{ flagPoint: { equals: current.flagPoint } }, { status: { in: ['running', 'decided'] } }] } })
      if (busy.docs.some(doc => String(doc.id) !== String(experimentId))) refuse('flag-point-busy')
    }
    const test = await readPhaseRecord(req, experimentId, current.phase!)
    if (test.phaseKind !== 'test') refuse('invalid-status')
    if (current.kind === 'page' && current.status === 'stopped') {
      // Deciding a stopped page test restores its routing: recheck page occupancy under the
      // sorted path locks Start takes, so another test that started on these pages meanwhile wins.
      // The frozen test-round arms are what decide restores; the stopped document's arms may have been edited.
      const mine = pageTargetPaths(test.arms as Arm[])
      await lockPagePaths(exec, mine)
      // Other tests' routed (frozen-round) arms, as the runtime matches them.
      const occupied = new Set((await routedPageTests(exec)).filter(other => String(other.id) !== String(experimentId)).flatMap(other => pageTargetPaths(other.arms)))
      const shared = mine.filter(path => occupied.has(path))
      if (shared.length) refuse('page-in-use', { paths: shared })
    }
    const winner = test.arms.find(arm => arm.key === winnerArm && arm.kind !== 'holdout')
    if (!winner) refuse('invalid-winner')
    // §7.8: decision snapshot lookup serves the authorised transition.
    const snapshots = await req.payload.find({ collection: 'xp-results-snapshots', req, overrideAccess: true, depth: 0, limit: 1,
      where: { and: [{ experiment: { equals: experimentId } }, { phase: { equals: test.phase } }] }, sort: ['-computedAt', '-id'] })
    const snapshotDoc = snapshots.docs[0]
    const snapshot = snapshotDoc?.snapshot as Snapshot | undefined
    if (decideGuard(snapshot ?? null, winnerArm) && (!note?.trim() || !matchesConfirm(expectedConfirm('decide', storedWinnerLabel(winner)), confirmation))) refuse('confirmation-required')
    const at = new Date().toISOString()
    const holdout = test.arms.find(arm => arm.kind === 'holdout')
    const rollout = holdout !== undefined && winner.kind !== 'control'
    let slices = current.layerSlices ?? []
    if (rollout && current.status === 'stopped' && relationshipId(current.layer) !== undefined) {
      const original = test.analysis?.layerSlices
      if (!Array.isArray(original) || original.length !== test.allocation || !original.every(slice => Number.isInteger(slice) && slice >= 0 && slice < 100) || new Set(original).size !== original.length) refuse('slices-taken')
      slices = await reclaimSlices(exec, { layerId: relationshipId(current.layer)!, experimentId, slices: original as number[] })
    }
    await setPhaseEndedAt(req, experimentId, test.phase, at)
    const phase = rollout ? test.phase + 1 : test.phase
    if (rollout) {
      const arms: Arm[] = [{ ...winner, weight: 100 - holdout!.weight }, { ...holdout!, weight: holdout!.weight }]
      await writePhaseRecord(req, { experiment: experimentId, phase, phaseKind: 'rollout', startedAt: at, seed: test.seed,
        arms, allocation: test.allocation, allocationChanges: [], targeting: test.targeting,
        metricDefinitions: test.metricDefinitions,
        analysis: { ...test.analysis,
          // Older test phases may predate freezing the effective tuning value.
          sequentialTuningParameter: test.analysis?.sequentialTuningParameter ?? DEFAULT_SEQUENTIAL_TUNING_PARAMETER,
        }, contentChanges: [] })
    }
    return updateExperiment(req, experimentId, { status: 'decided', phase, seed: test.seed, decidedAt: at, layerSlices: rollout ? slices : [],
      decision: { winnerArm, verdictCode: snapshot?.verdict.code ?? 'unavailable', note: note?.trim() ?? null,
        decidedBy: req.user?.id == null ? null : String(req.user.id), snapshotId: snapshotDoc ? String(snapshotDoc.id) : null } })
  })
  return { doc, revision: revision! }
}
