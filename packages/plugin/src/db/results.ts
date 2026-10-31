import type { DocId } from '../types/contracts.js'
import { timestampMs, type Timestamp } from '../results/aggregate.js'
import type { Executor } from './executor.js'
import { COLUMNS, TABLES } from './names.js'
import { qualifiedTable, quoteIdentifier as q } from './sql.js'

const c = COLUMNS.events
const batchSize = 10_000
const iso = (ts: Timestamp): string => new Date(timestampMs(ts)).toISOString()
// round()::bigint keeps exact milliseconds on servers where extract() returns a float (PG ≤ 13).
const epochMs = `round(extract(epoch from ${q(c.ts)}) * 1000)::bigint`

export interface PhaseExposureRow { unitId: string; arm: string; ts: number }
export interface RolloutExposureRow { unitId: string; phase: number; ts: number }
export interface MetricEventRow { unitId: string; userId: string | null; value: number; ts: number }
export interface IdentityRow { anonymousId: string; userId: string }
type PhaseQuery = { experimentId: DocId; phase: number; endedAt?: Timestamp }

function phaseFilter({ experimentId, phase, endedAt }: PhaseQuery, type: 'exposure' | 'arm-mismatch') {
  const params: unknown[] = [experimentId, phase, type]
  let text = `${q(c.experimentId)} = $1 AND ${q(c.phase)} = $2 AND ${q(c.type)} = $3`
  if (endedAt !== undefined) {
    params.push(iso(endedAt))
    text += ` AND ${q(c.ts)} < $4`
  }
  return { text, params }
}

/** All phase exposures, including multi-arm rows for firstExposures to exclude. */
export async function phaseExposureRows(exec: Executor, opts: PhaseQuery): Promise<PhaseExposureRow[]> {
  const filter = phaseFilter(opts, 'exposure')
  const { rows } = await exec.query<PhaseExposureRow>(`SELECT ${q(c.unitId)} AS "unitId", ${q(c.arm)} AS "arm", ${epochMs} AS "ts" FROM ${qualifiedTable(exec, TABLES.events)} WHERE ${filter.text} ORDER BY ${q(c.ts)}, ${q(c.unitId)}`, filter.params)
  return rows.map(row => ({ unitId: row.unitId, arm: row.arm, ts: Number(row.ts) }))
}

/** Diagnostic distinct units only; this never contributes to multi-arm exclusion. */
export async function armMismatchCount(exec: Executor, opts: PhaseQuery): Promise<number> {
  const filter = phaseFilter(opts, 'arm-mismatch')
  const { rows } = await exec.query<{ unitCount: number }>(`SELECT count(DISTINCT ${q(c.unitId)}) AS "unitCount" FROM ${qualifiedTable(exec, TABLES.events)} WHERE ${filter.text}`, filter.params)
  return Number(rows[0]!.unitCount)
}

/** All phases are required to identify first-ever exposure for rollout X1. */
export async function rolloutExposureRows(exec: Executor, { experimentId, respectPhaseEnds = false }: { experimentId: DocId; respectPhaseEnds?: boolean }): Promise<RolloutExposureRow[]> {
  const p = COLUMNS.phases
  const cutoff = respectPhaseEnds ? ` AND NOT EXISTS (SELECT 1 FROM ${qualifiedTable(exec, TABLES.phases)} p WHERE p.${q(p.experimentId)} = ${qualifiedTable(exec, TABLES.events)}.${q(c.experimentId)} AND p.${q(p.phase)} = ${qualifiedTable(exec, TABLES.events)}.${q(c.phase)} AND p.${q(p.endedAt)} <= ${qualifiedTable(exec, TABLES.events)}.${q(c.ts)})` : ''
  const { rows } = await exec.query<RolloutExposureRow>(`SELECT ${q(c.unitId)} AS "unitId", ${q(c.phase)} AS "phase", ${epochMs} AS "ts" FROM ${qualifiedTable(exec, TABLES.events)} WHERE ${q(c.experimentId)} = $1 AND ${q(c.type)} = $2${cutoff} ORDER BY ${q(c.ts)}, ${q(c.unitId)}, ${q(c.phase)}`, [experimentId, 'exposure'])
  return rows.map(row => ({ unitId: row.unitId, phase: Number(row.phase), ts: Number(row.ts) }))
}

/** events:<name> conversion rows in [from, to). Choose unitIds for stored unit_id,
 * or userIds for stored user_id (user units and visitor identity credit). Each distinct
 * ID occurs in one ANY array of at most 10,000, so batching cannot duplicate rows.
 */
export async function metricEventRows(exec: Executor, { eventName, unitIds, userIds, from, to }: {
  eventName: string; unitIds?: readonly string[]; userIds?: readonly string[]; from: Timestamp; to: Timestamp
}): Promise<MetricEventRow[]> {
  if (unitIds !== undefined && userIds !== undefined) throw new RangeError('Choose unitIds or userIds')
  const params: unknown[] = ['conversion', eventName, iso(from), iso(to)]
  const text = `SELECT ${q(c.unitId)} AS "unitId", ${q(c.userId)} AS "userId", ${q(c.value)} AS "value", ${epochMs} AS "ts" FROM ${qualifiedTable(exec, TABLES.events)} WHERE ${q(c.type)} = $1 AND ${q(c.eventName)} = $2 AND ${q(c.ts)} >= $3 AND ${q(c.ts)} < $4`
  const filterIds = userIds ?? unitIds
  const column = userIds === undefined ? c.unitId : c.userId
  const ids = filterIds === undefined ? undefined : [...new Set(filterIds)]
  const rows: MetricEventRow[] = []
  for (let offset = 0; ids === undefined || offset < ids.length; offset += batchSize) {
    const result = await exec.query<MetricEventRow>(`${text}${ids === undefined ? '' : ` AND ${q(column)} = ANY($5::text[])`} ORDER BY ${q(c.ts)}, ${q(c.unitId)}`, ids === undefined ? params : [...params, ids.slice(offset, offset + batchSize)])
    for (const row of result.rows) {
      rows.push({ unitId: row.unitId, userId: row.userId == null ? null : String(row.userId), value: Number(row.value), ts: Number(row.ts) })
    }
    if (ids === undefined) break
  }
  return rows
}

/** Linked visitors for creditUserEvents; disjoint ANY batches of ≤ 10,000 IDs. */
export async function identityRows(exec: Executor, { anonymousIds }: { anonymousIds: readonly string[] }): Promise<IdentityRow[]> {
  const ids = [...new Set(anonymousIds)]
  const i = COLUMNS.identities
  const rows: IdentityRow[] = []
  for (let offset = 0; offset < ids.length; offset += batchSize) {
    const result = await exec.query<IdentityRow>(`SELECT ${q(i.anonymousId)} AS "anonymousId", ${q(i.userId)} AS "userId" FROM ${qualifiedTable(exec, TABLES.identities)} WHERE ${q(i.anonymousId)} = ANY($1::text[]) ORDER BY ${q(i.anonymousId)}`, [ids.slice(offset, offset + batchSize)])
    rows.push(...result.rows.map(row => ({ anonymousId: row.anonymousId, userId: String(row.userId) })))
  }
  return rows
}
