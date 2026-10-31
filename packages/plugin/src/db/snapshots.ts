import type { Payload } from 'payload'
import type { Pool } from 'pg'
import type { DocId, UnitType } from '../types/contracts.js'
import type { Snapshot } from '../types/snapshot.js'
import type { AnalysisPhase, FrozenMetric } from '../results/analyse.js'
import { withStatementTimeout, type Executor } from './executor.js'
import { COLUMNS, TABLES } from './names.js'
import { qualifiedTable, quoteIdentifier as q } from './sql.js'

export interface ResultsPhase extends AnalysisPhase {
  seed: string
  allocation: number
  metricDefinitions: Array<FrozenMetric & { source: string; keyedBy?: UnitType; capNotice?: 'no-history' }>
}
export interface ResultsCandidate {
  phase: ResultsPhase
  unitType: UnitType
  status: 'running' | 'stopped' | 'decided' | 'archived'
  latestComputedAt: string | null
  testArms: Array<{ weight: number }>
  layerSlug: string | null
  layerSlices: number[] | null
}

/** Each query gets its own pooled connection and timeout transaction. A failed
 * metric query cannot poison the next metric's transaction. */
export function resultsExecutor(payload: Payload, timeoutMs: () => number): Executor {
  const db = payload.db as unknown as { pool: Pool; schemaName?: string }
  return Object.assign({
    query<R>(text: string, params?: unknown[]) {
      return withStatementTimeout(db.pool, Math.max(1, Math.ceil(timeoutMs())), exec => exec.query<R>(text, params))
    },
  }, { schemaName: db.schemaName })
}

/** Scheduling and immutable assignment metadata only; metric/config data comes
 * from the phase JSON, never from live metric or experiment analysis fields. */
export async function resultsCandidates(exec: Executor, { cutoff, experimentId }: { cutoff: string; experimentId?: DocId }): Promise<ResultsCandidate[]> {
  const p = COLUMNS.phases, e = COLUMNS.experiments, s = COLUMNS.resultsSnapshots, l = COLUMNS.layers
  const phases = qualifiedTable(exec, TABLES.phases), snapshots = qualifiedTable(exec, TABLES.resultsSnapshots)
  const params: unknown[] = [cutoff]
  if (experimentId !== undefined) params.push(experimentId)
  const { rows } = await exec.query<ResultsCandidate>(`SELECT
    jsonb_build_object('experiment', p.${q(p.experimentId)}, 'phase', p.${q(p.phase)}, 'phaseKind', p.${q(p.phaseKind)},
      'startedAt', p.${q(p.startedAt)}, 'endedAt', p.${q(p.endedAt)}, 'seed', p.${q(p.seed)},
      'arms', p.${q(p.arms)}, 'allocation', p.${q(p.allocation)}, 'metricDefinitions', p.${q(p.metricDefinitions)},
      'analysis', p.${q(p.analysis)}, 'contentChanges', p.${q(p.contentChanges)}) AS "phase",
    e.${q(e.unitType)} AS "unitType", e.${q(e.status)} AS "status",
    (SELECT max(s.${q(s.computedAt)}) FROM ${snapshots} s WHERE s.${q(s.experimentId)} = p.${q(p.experimentId)} AND s.${q(s.phase)} = p.${q(p.phase)}) AS "latestComputedAt",
    (SELECT t.${q(p.arms)} FROM ${phases} t WHERE t.${q(p.experimentId)} = p.${q(p.experimentId)} AND t.${q(p.phaseKind)} = 'test' AND t.${q(p.phase)} <= p.${q(p.phase)} ORDER BY t.${q(p.phase)} DESC LIMIT 1) AS "testArms",
    l.${q(l.slug)} AS "layerSlug", e.${q(e.layerSlices)} AS "layerSlices"
    FROM ${phases} p JOIN ${qualifiedTable(exec, TABLES.experiments)} e ON e.${q(e.id)} = p.${q(p.experimentId)}
    LEFT JOIN ${qualifiedTable(exec, TABLES.layers)} l ON l.${q(l.id)} = e.${q(e.layerId)}
    WHERE (p.${q(p.endedAt)} IS NULL OR p.${q(p.endedAt)} >= $1)${experimentId === undefined ? '' : ` AND p.${q(p.experimentId)} = $2`}
    ORDER BY "latestComputedAt" NULLS FIRST, p.${q(p.experimentId)}, p.${q(p.phase)}`, params)
  return rows
}

export async function writeSnapshot(exec: Executor, snapshot: Snapshot): Promise<void> {
  const c = COLUMNS.resultsSnapshots
  // §7.8: runResults writes are privileged internal side effects, using pooled SQL.
  await exec.query(`INSERT INTO ${qualifiedTable(exec, TABLES.resultsSnapshots)} (${q(c.experimentId)}, ${q(c.phase)}, ${q(c.computedAt)}, ${q(c.window)}, ${q(c.snapshot)}) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)`,
    [snapshot.experiment, snapshot.phase, snapshot.computedAt, JSON.stringify(snapshot.window), JSON.stringify(snapshot)])
}

/** Called only behind the endpoint's readResults gate. Experiment collection
 * reads require manage, so read only the decision pointer needed by results. */
export async function resultsMetadata(exec: Executor, id: DocId): Promise<{ status: string; snapshotId: DocId | null } | null> {
  const c = COLUMNS.experiments
  const { rows } = await exec.query<{ status: string; snapshotId: DocId | null }>(`SELECT ${q(c.status)} AS "status", ${q(c.decisionSnapshotId)} AS "snapshotId" FROM ${qualifiedTable(exec, TABLES.experiments)} WHERE ${q(c.id)} = $1`, [id])
  return rows[0] ?? null
}
