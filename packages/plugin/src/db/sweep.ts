import type { DocId } from '../types/contracts.js'
import type { Executor } from './executor.js'
import { COLUMNS, TABLES } from './names.js'
import { qualifiedTable, quoteIdentifier as q } from './sql.js'

/** §5.5 / §7.8: privileged retention sweep. Global conversions have no phase;
 * keep them while an open/recent phase could still need them. NULL experiment
 * exposures/mismatches are deletion orphans, not global conversions. */
export async function sweepEvents(exec: Executor, { now, retentionDays = 180, batchSize = 1000, shouldContinue = () => true }: {
  now: Date; retentionDays?: number; batchSize?: number; shouldContinue?: () => boolean
}): Promise<number> {
  if (!Number.isSafeInteger(retentionDays) || retentionDays < 1 || !Number.isSafeInteger(batchSize) || batchSize < 1) throw new RangeError('Invalid retention settings')
  const cutoff = new Date(now.getTime() - retentionDays * 86_400_000).toISOString()
  const c = COLUMNS.events, p = COLUMNS.phases, e = COLUMNS.experiments
  const events = qualifiedTable(exec, TABLES.events), phases = qualifiedTable(exec, TABLES.phases)
  let swept = 0
  // Separate predicates and index-aligned order avoid an OR over correlated
  // subqueries forcing a primary-key scan of the whole events table. Each
  // statement still goes through the caller's budget/race-aware executor.
  async function batches(predicate: string, order: string, params: unknown[] = []): Promise<void> {
    while (shouldContinue()) {
      const result = await exec.query(`DELETE FROM ${events} WHERE ${q(c.id)} IN (
        SELECT v.${q(c.id)} FROM ${events} v WHERE ${predicate}
        ORDER BY ${order} LIMIT $${params.length + 1})`, [...params, batchSize])
      swept += result.rowCount
      if (result.rowCount < batchSize) break
    }
  }
  const byExperiment = `v.${q(c.experimentId)}, v.${q(c.ts)}`
  const byTime = `v.${q(c.ts)}`
  // Experiment primary keys are non-null: NOT IN is null-safe here and keeps
  // the small id set as a hashed filter on the ordered event-index scan.
  await batches(`v.${q(c.experimentId)} IS NOT NULL AND v.${q(c.experimentId)} NOT IN (
    SELECT e.${q(e.id)} FROM ${qualifiedTable(exec, TABLES.experiments)} e)`, byExperiment)
  await batches(`v.${q(c.experimentId)} IS NULL AND v.${q(c.type)} <> 'conversion'`, byTime)
  if (!shouldContinue()) return swept
  // Find the final end from ALL phases first; an open rollout protects the old
  // test history. Recheck at delete time in case a new phase started meanwhile.
  const ended = await exec.query<{ experimentId: DocId }>(`SELECT ${q(p.experimentId)} AS "experimentId" FROM ${phases}
    WHERE ${q(p.experimentId)} IS NOT NULL GROUP BY ${q(p.experimentId)}
    HAVING NOT bool_or(${q(p.endedAt)} IS NULL) AND max(${q(p.endedAt)}) < $1`, [cutoff])
  if (ended.rows.length) {
    await batches(`v.${q(c.experimentId)} = ANY($1) AND NOT EXISTS (
      SELECT 1 FROM ${phases} p WHERE p.${q(p.experimentId)} = v.${q(c.experimentId)}
        AND (p.${q(p.endedAt)} IS NULL OR p.${q(p.endedAt)} >= $2))`, byExperiment, [ended.rows.map(row => row.experimentId), cutoff])
  }
  // experiment_id IS NULL plus the timestamp range uses (experiment_id, ts)
  // even though eventName is unconstrained; no extra conversion index is needed.
  await batches(`v.${q(c.experimentId)} IS NULL AND v.${q(c.type)} = 'conversion' AND v.${q(c.ts)} < $1
    AND NOT EXISTS (SELECT 1 FROM ${phases} p WHERE p.${q(p.experimentId)} IS NOT NULL
      GROUP BY p.${q(p.experimentId)} HAVING (bool_or(p.${q(p.endedAt)} IS NULL) OR max(p.${q(p.endedAt)}) >= $1)
      AND min(p.${q(p.startedAt)}) - interval '14 days' <= v.${q(c.ts)}
      AND (bool_or(p.${q(p.endedAt)} IS NULL) OR v.${q(c.ts)} < max(p.${q(p.endedAt)})))`, byTime, [cutoff])
  return swept
}
