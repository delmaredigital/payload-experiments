import type { DocId } from '../types/contracts.js'
import type { Executor } from './executor.js'
import { COLUMNS, TABLES } from './names.js'
import { qualifiedTable, quoteIdentifier as q } from './sql.js'
import { ResultsBudgetError } from './pgExecutor.js'

/** §5.5 / §7.8: privileged retention sweep. Deleted experiments' FKs become
 * NULL; their exposure and arm-mismatch rows are handled by the two NULL branches. Global
 * conversions stay while an open/recent experiment could still need them. */
export async function sweepEvents(exec: Executor, { now, retentionDays = 180, batchSize = 1000, shouldContinue = () => true, logger }: {
  now: Date; retentionDays?: number; batchSize?: number; shouldContinue?: () => boolean
  logger?: { warn(message: string): void }
}): Promise<number> {
  if (!Number.isSafeInteger(retentionDays) || retentionDays < 1 || !Number.isSafeInteger(batchSize) || batchSize < 1) throw new RangeError('Invalid retention settings')
  const cutoffMs = now.getTime() - retentionDays * 86_400_000
  const cutoff = new Date(cutoffMs).toISOString()
  const c = COLUMNS.events, p = COLUMNS.phases, s = COLUMNS.state
  const events = qualifiedTable(exec, TABLES.events), phases = qualifiedTable(exec, TABLES.phases)
  const revision = `(SELECT ${q(s.revision)} FROM ${qualifiedTable(exec, TABLES.state)} LIMIT 1)`
  let swept = 0
  // Each statement still uses the caller's budget/race-aware executor.
  async function batches(predicate: string, order: string, params: unknown[] = []): Promise<void> {
    while (shouldContinue()) {
      const result = await exec.query(`DELETE FROM ${events} WHERE ${q(c.id)} IN (
        SELECT v.${q(c.id)} FROM ${events} v WHERE ${predicate}
        ORDER BY ${order} LIMIT $${params.length + 1})`, [...params, batchSize])
      swept += result.rowCount
      if (result.rowCount < batchSize) break
    }
  }
  try {
    // Keep the leading NULL key in ORDER BY too: PostgreSQL does not infer
    // its ordering equivalence from IS NULL when choosing a bounded index scan.
    const byEventType = `v.${q(c.experimentId)}, v.${q(c.type)}, v.${q(c.ts)}`
    // Drain the two allow-listed diagnostic types with equality probes. An
    // ordered IN scan can otherwise read conversion entries and filter them.
    for (const type of ['exposure', 'arm-mismatch']) {
      await batches(`v.${q(c.experimentId)} IS NULL AND v.${q(c.type)} IN ($1)`, byEventType, [type])
    }
    if (!shouldContinue()) return swept
    // Final-endedAt retention protects every phase while any phase is open.
    const ended = await exec.query<{ experimentId: DocId }>(`SELECT ${q(p.experimentId)} AS "experimentId" FROM ${phases}
      WHERE ${q(p.experimentId)} IS NOT NULL GROUP BY ${q(p.experimentId)}
      HAVING NOT bool_or(${q(p.endedAt)} IS NULL) AND max(${q(p.endedAt)}) < $1`, [cutoff])
    if (ended.rows.length) {
      // Recheck in every batch in case a new phase started after the id read.
      await batches(`v.${q(c.experimentId)} = ANY($1) AND NOT EXISTS (
        SELECT 1 FROM ${phases} p WHERE p.${q(p.experimentId)} = v.${q(c.experimentId)}
          AND (p.${q(p.endedAt)} IS NULL OR p.${q(p.endedAt)} >= $2))`, byEventType, [ended.rows.map(row => row.experimentId), cutoff])
    }
    if (!shouldContinue()) return swept
    // Every protected window ends at/after cutoff (or is open). For old
    // conversions their union therefore starts at the earliest lookback start;
    // everything before that single bound is safe. Compute it once, in the same
    // snapshot as the state revision. Epoch milliseconds avoid timestamp parsing.
    const protectedRows = await exec.query<{ revision: number | null; before: number | null }>(`SELECT
      ${revision} AS revision, min(w."from") AS "before" FROM (
        SELECT extract(epoch FROM min(${q(p.startedAt)}) - interval '14 days') * 1000 AS "from"
        FROM ${phases} WHERE ${q(p.experimentId)} IS NOT NULL GROUP BY ${q(p.experimentId)}
        HAVING bool_or(${q(p.endedAt)} IS NULL) OR max(${q(p.endedAt)}) >= $1
      ) w`, [cutoff])
    const frozen = protectedRows.rows[0] ?? { revision: null, before: null }
    const before = new Date(Math.min(cutoffMs, frozen.before ?? cutoffMs)).toISOString()
    // Transitions bump revision in the same transaction as phase writes. This
    // uncorrelated initplan checks it once per statement, not per candidate. If a
    // phase starts mid-sweep, stale windows can delete no further conversions.
    await batches(`v.${q(c.experimentId)} IS NULL AND v.${q(c.type)} = 'conversion' AND v.${q(c.ts)} < $1
      AND ${revision} IS NOT DISTINCT FROM $2`, byEventType, [before, frozen.revision])
    return swept
  } catch (error) {
    if (swept === 0 && error instanceof ResultsBudgetError) {
      logger?.warn('Experiment retention sweep made no progress before its budget expired; eligible rows may remain.')
    }
    throw error
  }
}
