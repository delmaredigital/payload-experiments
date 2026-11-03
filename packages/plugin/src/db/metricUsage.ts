import type { Executor } from './executor.js'
import type { DocId } from '../types/contracts.js'
import { COLUMNS, TABLES } from './names.js'
import { qualifiedTable, quoteIdentifier as q } from './sql.js'

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
