import type { PayloadRequest } from 'payload'
import type { Arm, DocId, TargetingRule } from '../types/contracts.js'
import type { AllocationChange, ContentChange } from '../db/appends.js'
import { XpRefusal } from '../errors.js'

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
  // §7.8: transition endpoints' writes to plugin collections.
  return req.payload.create({
    collection: 'xp-phases', data: record, req,
    overrideAccess: true,
  })
}

/** End only an open phase, preserving the original stop time on a later decide.
 * Caller holds the experiment lock and passes the kernel's transaction req.
 */
export async function setPhaseEndedAt(req: PayloadRequest, experimentId: DocId, phase: number, at: string) {
  // §7.8: phase lookup for transition endpoints' writes to plugin collections.
  const { docs } = await req.payload.find({
    collection: 'xp-phases', req, limit: 1, depth: 0,
    where: { and: [{ experiment: { equals: experimentId } }, { phase: { equals: phase } }] },
    overrideAccess: true,
  })
  const record = docs[0]
  if (!record) throw new XpRefusal('not-found', 'The phase record was not found.', { experimentId, phase }, 404)
  if (record.endedAt) return record
  // §7.8: transition endpoints' writes to plugin collections.
  return req.payload.update({
    collection: 'xp-phases', req, id: record.id,
    data: { endedAt: at },
    overrideAccess: true,
  })
}
