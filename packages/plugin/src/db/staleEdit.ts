import type { Executor } from './executor.js'
import type { DocId } from '../types/contracts.js'
import { COLUMNS, TABLES } from './names.js'

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`

/** Request transaction only: hold the row lock through the experiment write. */
export async function lockExperimentUpdatedAt(exec: Executor & { schemaName?: string }, id: DocId): Promise<Date | string | null> {
  const table = `${exec.schemaName ? `${quote(exec.schemaName)}.` : ''}${quote(TABLES.experiments)}`
  const columns = COLUMNS.experiments
  const result = await exec.query<{ updatedAt: Date | string | null }>(
    `SELECT ${quote(columns.updatedAt)} AS "updatedAt" FROM ${table} WHERE ${quote(columns.id)} = $1 FOR UPDATE`, [id],
  )
  return result.rows[0]?.updatedAt ?? null
}
