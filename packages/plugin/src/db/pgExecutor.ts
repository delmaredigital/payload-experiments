import pg from 'pg'
import type { Pool, PoolClient } from 'pg'

export interface Executor {
  query<R>(text: string, params?: unknown[]): Promise<{ rows: R[]; rowCount: number }>
}

type Result = {
  rows: unknown[]; rowCount?: number | null; affectedRows?: number
  fields?: Array<{ name: string; dataTypeID: number }>
}

/** Scan only SQL code, leaving quoted text, identifiers and nested comments alone.
 * Both transports validate unused/missing params here before touching a database.
 */
export function scanParameters(text: string, params: unknown[]): Array<{ start: number; end: number; index: number }> {
  const positions: Array<{ start: number; end: number; index: number }> = []
  const used = new Set<number>()
  const identifier = (char: string | undefined) => char !== undefined && /[\p{L}\p{N}_$]/u.test(char)
  let i = 0
  while (i < text.length) {
    if (text.startsWith('--', i)) {
      const end = text.indexOf('\n', i + 2)
      i = end < 0 ? text.length : end + 1
    } else if (text.startsWith('/*', i)) {
      let depth = 1
      i += 2
      while (i < text.length && depth) {
        if (text.startsWith('/*', i)) { depth++; i += 2 }
        else if (text.startsWith('*/', i)) { depth--; i += 2 }
        else i++
      }
    } else if (text[i] === "'" || text[i] === '"') {
      const quote = text[i++]!
      const escaped = quote === "'" && /[eE]/.test(text[i - 2] ?? '') && !identifier(text[i - 3])
      while (i < text.length) {
        if (escaped && text[i] === '\\') i += 2
        else if (text[i++] === quote) {
          if (text[i] === quote) i++
          else break
        }
      }
    } else if (text[i] === '$' && !identifier(text[i - 1])) {
      const tag = /^(?:\$[A-Za-z_][A-Za-z_0-9]*\$|\$\$)/.exec(text.slice(i))?.[0]
      if (tag) {
        const end = text.indexOf(tag, i + tag.length)
        i = end < 0 ? text.length : end + tag.length
        continue
      }
      const token = /^\$(\d+)/.exec(text.slice(i))
      if (token) {
        const index = Number(token[1]) - 1
        if (!Number.isSafeInteger(index) || index < 0 || index >= params.length) throw new RangeError(`Missing SQL parameter ${token[0]}`)
        positions.push({ start: i, end: i + token[0].length, index })
        used.add(index)
        i += token[0].length
      } else i++
    } else i++
  }
  if (used.size !== params.length) throw new RangeError('Unused SQL parameters')
  return positions
}

function numeric(value: unknown, integer: boolean): number {
  if ((typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint') ||
    (typeof value === 'string' && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value))) {
    throw new RangeError('Invalid PostgreSQL numeric value')
  }
  const number = Number(value)
  if (!Number.isFinite(number)) throw new RangeError('Non-finite PostgreSQL numeric value')
  if (integer && !Number.isSafeInteger(number)) throw new RangeError('PostgreSQL int8 exceeds the safe integer range')
  return number
}

/** Normalise top-level columns only. Finite numeric (1700) always becomes a
 * number, accepting double precision rounding as the stats engine does. int8 (20)
 * becomes a number only within the safe integer range; invalid/non-finite numeric
 * and unsafe int8 values throw instead of changing a column's JS type by value.
 * Nulls stay null. timestamp/timestamptz (1114/1184) become UTC ISO strings; infinity
 * stays a string. JSON, text and opaque IDs stay intact. Drivers must retain raw
 * numeric text (pg's default, and per-query overrides below) until this boundary.
 */
export function normalise<R>(value: unknown): { rows: R[]; rowCount: number } {
  const result = value as Result
  const types = new Map(result.fields?.map(field => [field.name, field.dataTypeID]))
  const rows = result.rows.map(row => Object.fromEntries(Object.entries(row as Record<string, unknown>).map(([key, value]) => {
    const type = types.get(key)
    if ((type === 1700 || type === 20) && value !== null) value = numeric(value, type === 20)
    else if (value instanceof Date) value = value.toISOString()
    else if (typeof value === 'string' && (type === 1114 || type === 1184) && !/^-?infinity$/i.test(value)) {
      const timestamp = type === 1114 && !/(?:Z|[+-]\d{2}(?::?\d{2})?)$/.test(value) ? `${value}Z` : value
      value = new Date(timestamp).toISOString()
    }
    return [key, value]
  }))) as R[]
  return { rows, rowCount: result.rowCount ?? result.affectedRows ?? rows.length }
}

/** Per-query overrides avoid process-global pg parser changes and local-time
 * timestamp parsing. Other OIDs retain pg's default parsers (including JSON).
 */
const queryTypes = {
  getTypeParser(oid: number, format?: 'text' | 'binary') {
    if (format !== 'binary' && [20, 1700, 1114, 1184].includes(oid)) return (value: string) => value
    return pg.types.getTypeParser(oid, format)
  },
}

export function pgPoolExecutor(pool: Pool | PoolClient): Executor {
  return {
    async query<R>(text: string, params: unknown[] = []) {
      scanParameters(text, params)
      // QueryConfig is required to scope type parsers to this query.
      return normalise<R>(await pool.query({ text, values: params, types: queryTypes }))
    },
  }
}

/** The caller must release in finally; this connection never joins a Payload transaction. */
export async function ownConnection(pool: Pool): Promise<Executor & { release(error?: Error): void }> {
  const client = await pool.connect()
  const exec = pgPoolExecutor(client)
  let queryError: Error | undefined
  return {
    async query<R>(text: string, params?: unknown[]) {
      try { return await exec.query<R>(text, params) }
      catch (error) {
        queryError = error instanceof Error ? error : new Error('Query failed', { cause: error })
        throw error
      }
    },
    release: error => client.release(error ?? queryError),
  }
}

export async function withStatementTimeout<T>(pool: Pool, ms: number, fn: (exec: Executor) => Promise<T>): Promise<T> {
  if (!Number.isSafeInteger(ms) || ms <= 0) throw new RangeError('statement timeout must be a positive integer')
  const exec = await ownConnection(pool)
  let releaseError: Error | undefined
  try {
    await exec.query('BEGIN')
    await exec.query(`SET LOCAL statement_timeout = ${ms}`)
    const result = await fn(exec)
    await exec.query('COMMIT')
    return result
  } catch (error) {
    try { await exec.query('ROLLBACK') } catch (rollbackError) {
      releaseError = rollbackError instanceof Error ? rollbackError : new Error('Rollback failed', { cause: rollbackError })
    }
    throw error
  } finally { exec.release(releaseError) }
}
