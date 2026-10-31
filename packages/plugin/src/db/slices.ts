import type { Executor } from './executor.js'
import { COLUMNS, TABLES } from './names.js'
import { XpRefusal } from '../errors.js'
import type { DocId } from '../types/contracts.js'
import { qualifiedTable, quoteIdentifier as quote } from './sql.js'

/** Caller holds the layer lock on this transaction executor. Returns additional
 * free slices; the caller persists them in layerSlices. Existing slices, even
 * those of experimentId itself, stay occupied until explicitly freed with [].
 */
export async function claimSlices(exec: Executor, { layerId, experimentId, count, random = Math.random }: {
  layerId: DocId; experimentId: DocId; count: number; random?: () => number
}): Promise<number[]> {
  if (!Number.isSafeInteger(count) || count < 0) throw new RangeError('Slice count must be a non-negative integer')
  const table = qualifiedTable(exec, TABLES.experiments)
  const c = COLUMNS.experiments
  const { rows } = await exec.query<{ slices: number[] | null }>(
    `SELECT ${quote(c.layerSlices)} AS slices FROM ${table} WHERE ${quote(c.layerId)} = $1 AND ${quote(c.status)} IN ('running', 'decided')`,
    [layerId],
  )
  const occupied = new Set(rows.flatMap(row => row.slices ?? []))
  const free = Array.from({ length: 100 }, (_, slice) => slice).filter(slice => !occupied.has(slice))
  if (free.length < count) {
    throw new XpRefusal('layer-full', 'There is not enough room in this layer.', { layerId, experimentId, requested: count, available: free.length }, 409)
  }
  // Partial Fisher–Yates: each subset of the requested size is equally likely.
  for (let i = 0; i < count; i++) {
    const value = random()
    if (!(value >= 0 && value < 1)) throw new RangeError('Random must return a number in [0, 1)')
    const j = i + Math.floor(value * (free.length - i))
    ;[free[i], free[j]] = [free[j]!, free[i]!]
  }
  return free.slice(0, count).sort((a, b) => a - b)
}
