import type { Executor } from './executor.js'
import type { DocId } from '../types/contracts.js'

export const LOCK_NAMESPACES = {
  layer: 'xp:layer', flagPoint: 'xp:flagpoint', experiment: 'xp:experiment', pagePath: 'xp:pagepath',
} as const

const LOCK_STATEMENTS = {
  layer: `SELECT pg_advisory_xact_lock(hashtext('${LOCK_NAMESPACES.layer}'), hashtext($1))`,
  flagPoint: `SELECT pg_advisory_xact_lock(hashtext('${LOCK_NAMESPACES.flagPoint}'), hashtext($1))`,
  pagePath: `SELECT pg_advisory_xact_lock(hashtext('${LOCK_NAMESPACES.pagePath}'), hashtext($1))`,
  experiment: `SELECT pg_advisory_xact_lock(hashtext('${LOCK_NAMESPACES.experiment}'), hashtext($1))`,
} as const

/** Transaction executor only. Call in layer → flag point → experiment order;
 * the manifest builder takes the state lock last, after transition writes.
 */
export async function lockTransitionScope(exec: Executor, scope: {
  experimentId: DocId; layerId?: DocId | null; flagPointId?: string | null
}): Promise<void> {
  if (scope.layerId != null) await exec.query(LOCK_STATEMENTS.layer, [String(scope.layerId)])
  if (scope.flagPointId) await exec.query(LOCK_STATEMENTS.flagPoint, [scope.flagPointId])
  await exec.query(LOCK_STATEMENTS.experiment, [String(scope.experimentId)])
}

/** After layer → flag point → experiment, before metric/state locks. Paths must
 * already be normalised with the runtime's rules. Sorted keys avoid deadlocks
 * when different tests share several paths in different arm orders.
 */
export async function lockPagePaths(exec: Executor, paths: readonly string[]): Promise<void> {
  for (const path of [...new Set(paths)].sort()) await exec.query(LOCK_STATEMENTS.pagePath, [path])
}
