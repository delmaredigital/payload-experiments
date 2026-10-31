import type { PayloadRequest } from 'payload'
import type { EndpointContext, ErrorEnvelope, ResultsResponse, RefusalCode, PhaseSummary } from '../types/endpoints.js'
import type { DocId } from '../types/contracts.js'
import type { Snapshot } from '../types/snapshot.js'
import type { ResultsPhase } from '../db/snapshots.js'
import { resultsMetadata } from '../db/snapshots.js'
import { pooledExecutor } from '../db/executor.js'

const headers = { 'Cache-Control': 'no-store' }
export function resultsError(status: number, code: RefusalCode, message: string): Response {
  return Response.json({ errors: [{ code, message }] } satisfies ErrorEnvelope, { status, headers })
}

export type SnapshotDocument = { id: DocId; experiment: DocId | { id: DocId }; phase: number; computedAt: string; snapshot: Snapshot }
export async function readSnapshots(req: PayloadRequest, ids: DocId[]): Promise<SnapshotDocument[]> {
  const { docs } = await req.payload.find({ collection: 'xp-results-snapshots', req, overrideAccess: false, depth: 0,
    pagination: false, limit: 0, sort: '-computedAt', where: { experiment: { in: ids } } })
  return (docs as unknown as SnapshotDocument[]).sort((a, b) => Date.parse(b.computedAt) - Date.parse(a.computedAt) || String(b.id).localeCompare(String(a.id), undefined, { numeric: true }))
}

export async function handleResults<TUser extends { id: string | number } = { id: string | number }>(req: PayloadRequest, _ctx: EndpointContext<TUser>): Promise<Response> {
  const id = req.routeParams?.id
  if (typeof id !== 'string' && typeof id !== 'number') return resultsError(404, 'not-found', 'Experiment not found')
  const params = new URL(req.url ?? 'http://localhost').searchParams
  const selected = params.get('phase')
  if (selected !== null && (!/^\d+$/.test(selected) || !Number.isSafeInteger(Number(selected)) || Number(selected) < 1)) return resultsError(422, 'invalid-phase', 'Choose a valid round')
  const metadata = await resultsMetadata(pooledExecutor(req.payload), id)
  if (!metadata) return resultsError(404, 'not-found', 'Experiment not found')
  const { docs } = await req.payload.find({ collection: 'xp-phases', req, overrideAccess: false, depth: 0, pagination: false, limit: 0,
    where: { experiment: { equals: id } }, sort: 'phase' })
  const records = (docs as unknown as ResultsPhase[]).sort((a, b) => a.phase - b.phase)
  const phases: PhaseSummary[] = records.map(record => ({ phase: record.phase, phaseKind: record.phaseKind,
    startedAt: String(record.startedAt), endedAt: record.endedAt == null ? null : String(record.endedAt),
    arms: record.arms.map(({ key, label, kind }) => ({ key, label, kind })),
    metrics: record.metricDefinitions.map(({ metricId, name, kind, role, resolvedCap, historyUnits, capNotice }) => ({ metricId, name, kind, role,
      ...(resolvedCap === undefined ? {} : { resolvedCap }), ...(historyUnits === undefined ? {} : { historyUnits }), ...(capNotice ? { capNotice } : {}),
    })),
  }))
  const snapshots = await readSnapshots(req, [id])
  const decision = metadata.snapshotId == null ? undefined : snapshots.find(snapshot => String(snapshot.id) === String(metadata.snapshotId))?.snapshot
  const phase = selected === null ? decision?.phase ?? (metadata.status === 'decided' ? records.filter(record => record.phaseKind === 'test').at(-1)?.phase : records.at(-1)?.phase) : Number(selected)
  if (selected !== null && !records.some(record => record.phase === phase)) return resultsError(404, 'not-found', 'Round not found')
  const snapshot = snapshots.find(snapshot => snapshot.phase === phase)?.snapshot ?? null
  const response: ResultsResponse = { phases, snapshot, ...(decision ? { decisionSnapshot: decision } : {}) }
  if (params.get('series') === '1') response.series = snapshots.filter(snapshot => snapshot.phase === phase).reverse().flatMap(({ snapshot, computedAt }) =>
    snapshot.metrics.flatMap(metric => metric.comparisons.map(comparison => ({ computedAt, metricId: metric.metricId, arm: comparison.arm, lift: comparison.lift, ci: comparison.ciAdjusted }))))
  return Response.json(response, { headers })
}
