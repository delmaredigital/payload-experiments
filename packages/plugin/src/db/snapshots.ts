import type { Payload } from 'payload'
import type { Pool } from 'pg'
import type { Arm, DocId, ExperimentKind, Status, UnitType } from '../types/contracts.js'
import type { Snapshot } from '../types/snapshot.js'
import type { AnalysisPhase, FrozenMetric } from '../results/analyse.js'
import { withStatementTimeout, ResultsBudgetError, RESULTS_TIMEOUT_MARGIN_MS, type Executor } from './executor.js'
import { COLUMNS, TABLES } from './names.js'
import { qualifiedTable, quoteIdentifier as q } from './sql.js'

export interface ResultsPhase extends AnalysisPhase {
  arms: Array<AnalysisPhase['arms'][number] & Pick<Arm, 'pageTarget'>>
  seed: string
  allocation: number
  metricDefinitions: Array<FrozenMetric & { source: string; addedAt?: string; keyedBy?: UnitType; capNotice?: 'no-history' }>
}
export interface ResultsCandidate {
  slug?: string
  testPlacementDocs?: import('./placements.js').PlacementDoc[] | null
  phase: ResultsPhase
  frozenSnapshot?: Snapshot | null
  kind?: ExperimentKind
  pageCollection?: string | null
  currentPhase?: number
  winnerArm?: string | null
  unitType: UnitType
  status: 'running' | 'stopped' | 'decided' | 'archived'
  latestComputedAt: string | null
  testArms: Array<{ key: string; weight: number; kind?: string; pageTarget?: string }>
  layerSlug: string | null
  layerSlices: number[] | null
}

/** Each query gets its own pooled connection and timeout transaction. A failed
 * metric query cannot poison the next metric's transaction. */
export function resultsExecutor(payload: Payload, timeoutMs: () => number): Executor {
  const db = payload.db as unknown as { pool: Pool; schemaName?: string }
  return Object.assign({
    query<R>(text: string, params?: unknown[]) {
      const remaining = Math.floor(timeoutMs())
      if (remaining <= RESULTS_TIMEOUT_MARGIN_MS) return Promise.reject(new ResultsBudgetError())
      return withStatementTimeout(db.pool, remaining - RESULTS_TIMEOUT_MARGIN_MS, exec => exec.query<R>(text, params), Date.now() + remaining)
    },
  }, { schemaName: db.schemaName })
}

// CORE-16 README: allow late beacons for 24 hours after a phase ends, then keep
// its final snapshot frozen. This is internal scheduling policy, not public API.
const LATE_BEACON_GRACE_MS = 24 * 60 * 60 * 1000

/** Scheduling and immutable assignment metadata only; metric/config data comes
 * from the phase JSON, never from live metric or experiment analysis fields. */
export async function resultsCandidates(exec: Executor, { cutoff, experimentId }: { cutoff: string; experimentId?: DocId }): Promise<ResultsCandidate[]> {
  const p = COLUMNS.phases, e = COLUMNS.experiments, s = COLUMNS.resultsSnapshots, l = COLUMNS.layers
  const phases = qualifiedTable(exec, TABLES.phases), snapshots = qualifiedTable(exec, TABLES.resultsSnapshots)
  const params: unknown[] = [cutoff, LATE_BEACON_GRACE_MS]
  if (experimentId !== undefined) params.push(experimentId)
  const { rows } = await exec.query<ResultsCandidate>(`SELECT
    jsonb_build_object('experiment', p.${q(p.experimentId)}, 'phase', p.${q(p.phase)}, 'phaseKind', p.${q(p.phaseKind)},
      'startedAt', p.${q(p.startedAt)}, 'endedAt', p.${q(p.endedAt)}, 'seed', p.${q(p.seed)},
      'arms', p.${q(p.arms)}, 'allocation', p.${q(p.allocation)}, 'metricDefinitions', p.${q(p.metricDefinitions)},
      'analysis', p.${q(p.analysis)}, 'contentChanges', p.${q(p.contentChanges)}) AS "phase",
    e.${q(e.slug)} AS "slug",
    (SELECT t.${q(p.placementDocs)} FROM ${phases} t WHERE t.${q(p.experimentId)} = p.${q(p.experimentId)} AND t.${q(p.phaseKind)} = 'test' AND t.${q(p.phase)} <= p.${q(p.phase)} ORDER BY t.${q(p.phase)} DESC LIMIT 1) AS "testPlacementDocs",
    e.${q(e.pageCollection)} AS "pageCollection", e.${q(e.kind)} AS "kind", e.${q(e.phase)} AS "currentPhase", e.${q(e.unitType)} AS "unitType", e.${q(e.status)} AS "status", e.${q(e.decisionWinnerArm)} AS "winnerArm",
    latest."computedAt" AS "latestComputedAt",
    (SELECT t.${q(p.arms)} FROM ${phases} t WHERE t.${q(p.experimentId)} = p.${q(p.experimentId)} AND t.${q(p.phaseKind)} = 'test' AND t.${q(p.phase)} <= p.${q(p.phase)} ORDER BY t.${q(p.phase)} DESC LIMIT 1) AS "testArms",
    frozen."snapshot" AS "frozenSnapshot",
    l.${q(l.slug)} AS "layerSlug", e.${q(e.layerSlices)} AS "layerSlices"
    FROM ${phases} p JOIN ${qualifiedTable(exec, TABLES.experiments)} e ON e.${q(e.id)} = p.${q(p.experimentId)}
    LEFT JOIN ${qualifiedTable(exec, TABLES.layers)} l ON l.${q(l.id)} = e.${q(e.layerId)}
    LEFT JOIN LATERAL (SELECT max(s.${q(s.computedAt)}) AS "computedAt" FROM ${snapshots} s
      WHERE s.${q(s.experimentId)} = p.${q(p.experimentId)} AND s.${q(s.phase)} = p.${q(p.phase)}) latest ON true
    LEFT JOIN LATERAL (SELECT s.${q(s.snapshot)} AS "snapshot" FROM ${snapshots} s
      WHERE s.${q(s.experimentId)} = p.${q(p.experimentId)} AND s.${q(s.phase)} = p.${q(p.phase)}
        AND p.${q(p.endedAt)} IS NOT NULL
        AND (s.${q(s.computedAt)} > p.${q(p.endedAt)} + $2 * interval '1 millisecond' OR p.${q(p.endedAt)} < $1)
      ORDER BY s.${q(s.computedAt)} DESC, s.${q(s.id)} DESC LIMIT 1) frozen ON true
    WHERE (((e.${q(e.kind)} = 'page' OR EXISTS (SELECT 1 FROM jsonb_array_elements(p.${q(p.metricDefinitions)}) goal WHERE goal->>'source' LIKE 'click:%'))
        AND (p.${q(p.endedAt)} IS NULL OR p.${q(p.endedAt)} >= $1 OR EXISTS
          (SELECT 1 FROM ${snapshots} existing WHERE existing.${q(s.experimentId)} = p.${q(p.experimentId)} AND existing.${q(s.phase)} = p.${q(p.phase)}))
        AND e.${q(e.status)} IN ('running', 'decided') AND (p.${q(p.phase)} = e.${q(e.phase)}
        OR p.${q(p.phase)} = (SELECT max(active.${q(p.phase)}) FROM ${phases} active WHERE active.${q(p.experimentId)} = e.${q(e.id)} AND active.${q(p.phaseKind)} = 'test')))
      OR ((p.${q(p.endedAt)} IS NULL OR p.${q(p.endedAt)} >= $1)
        AND NOT EXISTS (SELECT 1 FROM ${snapshots} done WHERE done.${q(s.experimentId)} = p.${q(p.experimentId)} AND done.${q(s.phase)} = p.${q(p.phase)}
          AND done.${q(s.computedAt)} > p.${q(p.endedAt)} + $2 * interval '1 millisecond')))
      ${experimentId === undefined ? '' : ` AND p.${q(p.experimentId)} = $3`}
    ORDER BY (frozen."snapshot" IS NOT NULL),
      CASE WHEN frozen."snapshot" IS NULL THEN latest."computedAt" END NULLS FIRST,
      CASE WHEN frozen."snapshot" IS NOT NULL THEN random() END,
      p.${q(p.experimentId)}, p.${q(p.phase)}`, params)
  return rows
}

export async function writeSnapshot(exec: Executor, snapshot: Snapshot): Promise<void> {
  return writeSnapshots(exec, [snapshot])
}

/** One atomic insert after all phases complete: a budget failure cannot leave
 * the experiment with a partially persisted set of phase snapshots. */
export async function writeSnapshots(exec: Executor, snapshots: Snapshot[]): Promise<void> {
  if (!snapshots.length) return
  const c = COLUMNS.resultsSnapshots
  const params: unknown[] = []
  const values = snapshots.map(snapshot => {
    const offset = params.length
    params.push(snapshot.experiment, snapshot.phase, snapshot.computedAt, JSON.stringify(snapshot.window), JSON.stringify(snapshot))
    return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}::jsonb, $${offset + 5}::jsonb)`
  })
  // §7.8: runResults writes are privileged internal side effects, using pooled SQL.
  await exec.query(`INSERT INTO ${qualifiedTable(exec, TABLES.resultsSnapshots)} (${q(c.experimentId)}, ${q(c.phase)}, ${q(c.computedAt)}, ${q(c.window)}, ${q(c.snapshot)}) VALUES ${values.join(', ')}`, params)
}

/** Fetch pointers only, then the endpoint reads the bounded set through Payload
 * with req/overrideAccess:false. Called behind the readResults/manage gate. */
export async function newestSnapshotIds(exec: Executor, ids: DocId[], per: 'phase' | 'experiment'): Promise<DocId[]> {
  if (!ids.length) return []
  const c = COLUMNS.resultsSnapshots
  const partition = [c.experimentId, ...(per === 'phase' ? [c.phase] : [])].map(q).join(', ')
  const params: unknown[] = []
  const placeholders = ids.map(id => { params.push(id); return `$${params.length}` })
  const { rows } = await exec.query<{ id: DocId }>(`SELECT DISTINCT ON (${partition}) ${q(c.id)} AS "id" FROM ${qualifiedTable(exec, TABLES.resultsSnapshots)} WHERE ${q(c.experimentId)} IN (${placeholders.join(', ')}) ORDER BY ${partition}, ${q(c.computedAt)} DESC, ${q(c.id)} DESC`, params)
  return rows.map(row => row.id)
}

type ResultsMetadata = { name: string | null; kind: ExperimentKind; status: Status; snapshotId: DocId | null; winnerArm: string | null }

/** Called only behind the endpoint's readResults gate. Experiment collection
 * reads require manage, so read only the identity and decision metadata needed by results. */
export async function resultsMetadata(exec: Executor, id: DocId): Promise<ResultsMetadata | null> {
  const c = COLUMNS.experiments
  const { rows } = await exec.query<ResultsMetadata>(`SELECT ${q(c.name)} AS "name", ${q(c.kind)} AS "kind", ${q(c.status)} AS "status", ${q(c.decisionSnapshotId)} AS "snapshotId", ${q(c.decisionWinnerArm)} AS "winnerArm" FROM ${qualifiedTable(exec, TABLES.experiments)} WHERE ${q(c.id)} = $1`, [id])
  return rows[0] ?? null
}
