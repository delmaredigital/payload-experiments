import type { Executor } from './executor.js'
import { COLUMNS, TABLES } from './names.js'
import type { DocId } from '../types/contracts.js'

export interface AllocationChange { at: string; from: number; to: number }
export interface ContentChange { at: string; doc: DocId; by: DocId }
type AppendArgs<T> = { experimentId: DocId; phase: number; entry: T }
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`

async function append<T>(exec: Executor, column: string, { experimentId, phase, entry }: AppendArgs<T>): Promise<void> {
  const schemaName = (exec as Executor & { schemaName?: string }).schemaName
  const table = `${schemaName ? `${quote(schemaName)}.` : ''}${quote(TABLES.phases)}`
  const c = COLUMNS.phases
  await exec.query(
    `UPDATE ${table} SET ${quote(column)} = coalesce(${quote(column)}, '[]'::jsonb) || $1::jsonb WHERE ${quote(c.experimentId)} = $2 AND ${quote(c.phase)} = $3`,
    [JSON.stringify([entry]), experimentId, phase],
  )
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
