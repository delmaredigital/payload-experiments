import type { DocId } from '../types/contracts.js'
import type { Executor } from './executor.js'
import { TABLES, COLUMNS } from './names.js'
import { qualifiedTable, quoteIdentifier as q } from './sql.js'
import { normalisePath } from '../runtime/normalisePath.js'

/** Current running round, independent of manifest compilation and typed targeting. */
export async function pageContentBindings(exec: Executor, collection: string, paths: readonly string[]): Promise<DocId[]> {
  if (!paths.length) return []
  const e = COLUMNS.experiments, p = COLUMNS.phases
  const { rows } = await exec.query<{ id: DocId; arms: Array<{ pageTarget?: string }> }>(`SELECT x.${q(e.id)} AS id, p.${q(p.arms)} AS arms
    FROM ${qualifiedTable(exec, TABLES.experiments)} x JOIN ${qualifiedTable(exec, TABLES.phases)} p
    ON p.${q(p.experimentId)} = x.${q(e.id)} AND p.${q(p.phase)} = x.${q(e.phase)}
    WHERE x.${q(e.kind)} = 'page' AND x.${q(e.status)} = 'running'
      AND (x.${q(e.pageCollection)} = $1 OR x.${q(e.pageCollection)} IS NULL)`, [collection])
  const wanted = new Set(paths)
  return rows.filter(row => row.arms.some(arm => typeof arm.pageTarget === 'string' && wanted.has(normalisePath(arm.pageTarget)))).map(row => row.id)
}
