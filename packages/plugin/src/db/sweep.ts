import type { Executor } from './executor.js'
import { COLUMNS, TABLES } from './names.js'
import { qualifiedTable, quoteIdentifier as q } from './sql.js'
import { ResultsBudgetError } from './pgExecutor.js'

/** §5.5 / §7.8: privileged retention sweep. Global conversions have no phase;
 * keep them while an open/recent phase could still need them. NULL experiment
 * exposures/mismatches are deletion orphans, not global conversions. */
export async function sweepEvents(exec: Executor, { now, retentionDays = 180, batchSize = 1000, shouldContinue = () => true, logger }: {
  now: Date; retentionDays?: number; batchSize?: number; shouldContinue?: () => boolean
  logger?: { warn(message: string): void }
}): Promise<number> {
  if (!Number.isSafeInteger(retentionDays) || retentionDays < 1 || !Number.isSafeInteger(batchSize) || batchSize < 1) throw new RangeError('Invalid retention settings')
  const cutoff = new Date(now.getTime() - retentionDays * 86_400_000).toISOString()
  const c = COLUMNS.events, p = COLUMNS.phases, e = COLUMNS.experiments
  const events = qualifiedTable(exec, TABLES.events), phases = qualifiedTable(exec, TABLES.phases)
  let swept = 0
  try {
    while (shouldContinue()) {
      const result = await exec.query(`DELETE FROM ${events} WHERE ${q(c.id)} IN (
        SELECT v.${q(c.id)} FROM ${events} v WHERE
          (v.${q(c.experimentId)} IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ${qualifiedTable(exec, TABLES.experiments)} e WHERE e.${q(e.id)} = v.${q(c.experimentId)}))
          OR (v.${q(c.experimentId)} IS NULL AND v.${q(c.type)} <> 'conversion')
          OR EXISTS (SELECT 1 FROM ${phases} p WHERE p.${q(p.experimentId)} = v.${q(c.experimentId)}
            GROUP BY p.${q(p.experimentId)} HAVING NOT bool_or(p.${q(p.endedAt)} IS NULL) AND max(p.${q(p.endedAt)}) < $1)
          OR (v.${q(c.experimentId)} IS NULL AND v.${q(c.type)} = 'conversion' AND v.${q(c.ts)} < $1
            AND NOT EXISTS (SELECT 1 FROM ${phases} p WHERE p.${q(p.experimentId)} IS NOT NULL
              GROUP BY p.${q(p.experimentId)} HAVING (bool_or(p.${q(p.endedAt)} IS NULL) OR max(p.${q(p.endedAt)}) >= $1)
              AND min(p.${q(p.startedAt)}) - interval '14 days' <= v.${q(c.ts)}
              AND (bool_or(p.${q(p.endedAt)} IS NULL) OR v.${q(c.ts)} < max(p.${q(p.endedAt)}))))
        ORDER BY v.${q(c.id)} LIMIT $2)`, [cutoff, batchSize])
      swept += result.rowCount
      if (result.rowCount < batchSize) break
    }
  } catch (error) {
    if (swept === 0 && error instanceof ResultsBudgetError) {
      logger?.warn('Experiment retention sweep made no progress before its budget expired; eligible rows may remain.')
    }
    throw error
  }
  return swept
}
