import type { Executor } from './executor.js'
import type { DocId } from '../types/contracts.js'
import { COLUMNS, TABLES } from './names.js'
import { qualifiedTable, quoteIdentifier as q } from './sql.js'

/** Request transaction only: serialize the guard with FK checks and freezes. */
export async function lockMetricRow(exec: Executor, id: DocId, mode: 'delete' | 'change'): Promise<void> {
  const lock = mode === 'delete' ? 'FOR UPDATE' : 'FOR NO KEY UPDATE'
  await exec.query(`SELECT 1 FROM ${qualifiedTable(exec, TABLES.metrics)} WHERE ${q(COLUMNS.metrics.id)} = $1 ${lock}`, [id])
}

/** Transition transaction only, after advisory locks. SQL orders by the native
 * id type so overlapping freezes always acquire row locks in the same order.
 * Return the locked identities so callers can reject a change that committed
 * after preflight. Missing rows mean a goal was deleted; never freeze that copy.
 * txExecutor throws if the request no longer has a transaction session.
 */
export async function lockMetricsForFreeze(exec: Executor, ids: DocId[]): Promise<Array<{ id: DocId; slug: string; source: string }> | null> {
  const sorted = [...new Map(ids.map(id => [String(id), id])).values()]
    .sort((a, b) => typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b)))
  const m = COLUMNS.metrics, id = q(m.id)
  const result = await exec.query<{ id: DocId; slug: string; source: string }>(`SELECT ${id}, ${q(m.slug)}, ${q(m.source)} FROM ${qualifiedTable(exec, TABLES.metrics)} WHERE ${id} = ANY($1) ORDER BY ${id} FOR SHARE`, [sorted])
  return result.rows.length === sorted.length ? result.rows : null
}

/** Live selections cover drafts; frozen definitions keep historical goals in use. */
export async function findMetricUsage(exec: Executor, id: DocId): Promise<{ name: string } | null> {
  const e = COLUMNS.experiments, p = COLUMNS.phases, r = COLUMNS.experimentsRels
  const result = await exec.query<{ name: string }>(`
    SELECT COALESCE(usage.name, 'Deleted test') AS name FROM (
      SELECT e.${q(e.name)} AS name, e.${q(e.status)} AS status
      FROM ${qualifiedTable(exec, TABLES.phases)} p
      LEFT JOIN ${qualifiedTable(exec, TABLES.experiments)} e ON e.${q(e.id)} = p.${q(p.experimentId)}
      WHERE jsonb_typeof(p.${q(p.metricDefinitions)}) = 'array' AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(p.${q(p.metricDefinitions)}) definition
        WHERE definition->>'metricId' = $1::text
      )
      UNION ALL
      SELECT e.${q(e.name)} AS name, e.${q(e.status)} AS status
      FROM ${qualifiedTable(exec, TABLES.experiments)} e
      WHERE e.${q(e.metricsPrimaryId)}::text = $1::text OR EXISTS (
        SELECT 1 FROM ${qualifiedTable(exec, TABLES.experimentsRels)} r
        WHERE r.${q(r.parentId)} = e.${q(e.id)}
          AND r.${q(r.path)} IN ('metrics.secondary', 'metrics.guardrails')
          AND r.${q(r.xpMetricsId)}::text = $1::text
      )
    ) usage
    ORDER BY CASE WHEN usage.status IN ('running', 'decided') THEN 0 ELSE 1 END, usage.name
    LIMIT 1`, [String(id)])
  return result.rows[0] ?? null
}
