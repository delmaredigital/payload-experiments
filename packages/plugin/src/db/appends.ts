import type { Executor } from './executor.js'
import { COLUMNS, TABLES } from './names.js'
import type { DocId } from '../types/contracts.js'
import { XpRefusal } from '../errors.js'
import { qualifiedTable, quoteIdentifier as quote } from './sql.js'

export interface AllocationChange { at: string; from: number; to: number }
export interface ContentChange { at: string; doc: { collection: string; id: DocId }; by: DocId | null }
type AppendArgs<T> = { experimentId: DocId; phase: number; entry: T }

/** §7.8 contentChanges exception: internal lookup on the host transaction.
 * Use the executor directly: Payload Local API read errors kill the caller's
 * transaction before a never-throw hook can recover its audit savepoint.
 */
export async function runningContentExperiment(exec: Executor, binding: { field: 'id' | 'slug'; value: DocId }): Promise<{ id: DocId; phase: number } | undefined> {
  const table = qualifiedTable(exec, TABLES.experiments)
  const c = COLUMNS.experiments
  const { rows } = await exec.query<{ id: DocId; phase: number }>(
    `SELECT ${quote(c.id)} AS id, ${quote(c.phase)} AS phase FROM ${table} WHERE ${quote(c[binding.field])} = $1 AND ${quote(c.status)} = 'running' LIMIT 1`,
    [binding.value],
  )
  return rows[0]
}

async function append<T>(exec: Executor, column: string, { experimentId, phase, entry }: AppendArgs<T>): Promise<void> {
  const table = qualifiedTable(exec, TABLES.phases)
  const c = COLUMNS.phases
  const { rowCount } = await exec.query(
    `UPDATE ${table} SET ${quote(column)} = coalesce(${quote(column)}, '[]'::jsonb) || $1::jsonb WHERE ${quote(c.experimentId)} = $2 AND ${quote(c.phase)} = $3`,
    [JSON.stringify([entry]), experimentId, phase],
  )
  if (rowCount === 0) throw new XpRefusal('not-found', 'The phase record was not found.', { experimentId, phase }, 404)
}

/** Requires the experiment lock on the transaction executor (withTransition).
 * The generated schema stores allocationChanges as one JSONB column, not rows.
 */
export function appendAllocationChange(exec: Executor, args: AppendArgs<AllocationChange>): Promise<void> {
  return append(exec, COLUMNS.phases.allocationChanges, args)
}

/** Requires the experiment lock on the transaction executor (withTransition).
 * The generated schema stores contentChanges as one JSONB column, not rows.
 */
export function appendContentChange(exec: Executor, args: AppendArgs<ContentChange>): Promise<void> {
  return append(exec, COLUMNS.phases.contentChanges, args)
}

/** A best-effort audit must not abort the host write sharing its transaction.
 * Recover SQL errors before returning them: catching alone leaves Postgres aborted.
 */
export async function contentChangeSavepoint<T>(exec: Executor, fn: () => Promise<T>): Promise<{ ok: true; result: T } | { ok: false; error: unknown }> {
  await exec.query('SAVEPOINT xp_content_change')
  try {
    const result = await fn()
    await exec.query('RELEASE SAVEPOINT xp_content_change')
    return { ok: true, result }
  } catch (error) {
    await exec.query('ROLLBACK TO SAVEPOINT xp_content_change')
    await exec.query('RELEASE SAVEPOINT xp_content_change')
    return { ok: false, error }
  }
}
