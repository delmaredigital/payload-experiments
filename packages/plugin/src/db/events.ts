import { exposureDimensions } from '../events/dimensions.js'
import type { DocId, UnitType } from '../types/contracts.js'
import type { Executor } from './executor.js'
import { COLUMNS, TABLES } from './names.js'
import { qualifiedTable, quoteIdentifier } from './sql.js'

/** Delete cascade: caller holds the experiment lock in the delete transaction. */
export async function deleteExperimentEvents(exec: Executor, experimentId: DocId): Promise<void> {
  await exec.query(`DELETE FROM ${qualifiedTable(exec, TABLES.events)} WHERE ${quoteIdentifier(COLUMNS.events.experimentId)} = $1`, [experimentId])
}

export interface EventRow {
  type: 'exposure' | 'conversion' | 'arm-mismatch'
  experimentId?: DocId
  phase?: number
  arm?: string
  unitId: string
  unitType: UnitType
  userId?: string
  eventName?: string
  value?: number
  ts: string
  dimensions?: Record<string, string | number | boolean> | null
  attributes?: Record<string, unknown>
  dedupeKey: string
}

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`
const c = COLUMNS.events

function foreignKeyViolation(error: unknown): boolean {
  const seen = new Set<unknown>()
  while (error && typeof error === 'object' && !seen.has(error)) {
    seen.add(error)
    const failure = error as { code?: string; cause?: unknown }
    if (failure.code === '23503') return true
    error = failure.cause
  }
  return false
}

/** Dimensions are optional: malformed host values (including custom toJSON or
 * cyclic objects from JavaScript callers) must not abort any row in the batch. */
function serialiseDimensions(row: EventRow): string | null {
  if (row.type !== 'exposure' || !row.dimensions) return null
  try {
    const dimensions = exposureDimensions(row.dimensions, Object.keys(row.dimensions))
    return dimensions ? JSON.stringify(dimensions) : null
  } catch { return null }
}

/** Pooled/autocommit executor required: an FK failure must not poison a caller's transaction. */
export async function insertEvents(exec: Executor, rows: EventRow[], log: (message: string) => void = console.error): Promise<number> {
  const valid = rows.filter(row => {
    if (row.value === undefined || Number.isFinite(row.value)) return true
    log('Experiments: dropped event with non-finite value')
    return false
  })
  if (!valid.length) return 0
  const schema = (exec as Executor & { schemaName?: string }).schemaName
  const table = `${schema ? `${quote(schema)}.` : ''}${quote(TABLES.events)}`
  async function insert(batch: EventRow[]): Promise<number> {
    const params: unknown[] = []
    const values = batch.map(row => {
      const fields = [row.type, row.experimentId ?? null, row.phase ?? null, row.arm ?? null, row.unitId, row.unitType,
        row.userId ?? null, row.eventName ?? null, row.value ?? null, row.ts,
        serialiseDimensions(row),
        row.attributes === undefined ? null : JSON.stringify(row.attributes), row.dedupeKey]
      return `(${fields.map(value => { params.push(value); return `$${params.length}` }).join(', ')}, now(), now())`
    })
    const result = await exec.query(`INSERT INTO ${table} (${[c.type, c.experimentId, c.phase, c.arm, c.unitId, c.unitType,
      c.userId, c.eventName, c.value, c.ts, c.dimensions, c.attributes, c.dedupeKey, c.createdAt, c.updatedAt].map(quote).join(', ')}) VALUES ${values.join(', ')} ON CONFLICT (${quote(c.dedupeKey)}) DO NOTHING RETURNING ${quote(c.id)}`, params)
    return result.rows.length
  }
  try { return await insert(valid) } catch (error) {
    if (!foreignKeyViolation(error)) throw error
    // The failed statement is atomic. Retry separately to retain unaffected rows.
    let count = 0
    for (const row of valid) {
      try { count += await insert([row]) } catch (error) {
        if (!foreignKeyViolation(error)) throw error
        log('Experiments: dropped event after concurrent experiment deletion')
      }
    }
    return count
  }
}
