import type { PayloadRequest } from 'payload'
import type { Arm, DocId, TargetingRule } from '../types/contracts.js'
import type { AllocationChange, ContentChange } from '../db/appends.js'

export interface PhaseRecord {
  experiment: DocId
  phase: number
  phaseKind: 'test' | 'rollout'
  startedAt: string
  endedAt?: string | null
  seed: string
  arms: Arm[]
  allocation: number
  allocationChanges?: AllocationChange[]
  targeting: TargetingRule[]
  metricDefinitions?: Array<Record<string, unknown>>
  analysis?: Record<string, unknown>
  contentChanges?: ContentChange[]
}

/** Caller holds the experiment lock and passes the kernel's transaction req. */
export async function writePhaseRecord(req: PayloadRequest, record: PhaseRecord) {
  return req.payload.create({
    collection: 'xp-phases', data: record, req,
    // §7.8: transition endpoints' writes to plugin collections.
    overrideAccess: true,
  })
}

/** End only an open phase, preserving the original stop time on a later decide.
 * Caller holds the experiment lock and passes the kernel's transaction req.
 */
export async function setPhaseEndedAt(req: PayloadRequest, experimentId: DocId, phase: number, at: string): Promise<void> {
  await req.payload.update({
    collection: 'xp-phases', req,
    where: { and: [
      { experiment: { equals: experimentId } }, { phase: { equals: phase } },
      { or: [{ endedAt: { exists: false } }, { endedAt: { equals: null } }] },
    ] },
    data: { endedAt: at },
    // §7.8: transition endpoints' writes to plugin collections.
    overrideAccess: true,
  })
}
