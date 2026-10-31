import { sql } from '@payloadcms/db-postgres/drizzle'
import type { PostgresAdapter } from '@payloadcms/db-postgres'
import type { Payload, PayloadRequest } from 'payload'
import type { Pool, PoolClient } from 'pg'
import { XpNoTransactionError } from '../errors.js'

export interface Executor {
  query<R>(text: string, params?: unknown[]): Promise<{ rows: R[]; rowCount: number }>
}

type Result = {
  rows: unknown[]; rowCount?: number | null; affectedRows?: number
  fields?: Array<{ name: string; dataTypeID: number }>
}
type Database = { execute(query: ReturnType<typeof sql.raw>): Promise<unknown> }
type PostgresDatabase = Pick<PostgresAdapter, 'schemaName' | 'drizzle' | 'sessions'>

/** Convert positional placeholders in SQL code to bound Drizzle parameters.
 * Quoted strings/identifiers, comments and dollar-quoted bodies are left intact.
 * A repeated/out-of-order $n binds the corresponding value again; arrays are
 * always a single sql.param rather than Drizzle's list interpolation.
 */
function bind(text: string, params: unknown[]) {
  const chunks: ReturnType<typeof sql.raw>[] = []
  const tokens = /'(?:''|[^'])*'|"(?:""|[^"])*"|--[^\n]*|\/\*[\s\S]*?\*\/|\$(?:[a-zA-Z_][a-zA-Z_0-9]*)?\$[\s\S]*?\$(?:[a-zA-Z_][a-zA-Z_0-9]*)?\$|\$(\d+)/g
  let start = 0
  for (const match of text.matchAll(tokens)) {
    if (!match[1]) continue
    const index = Number(match[1]) - 1
    if (index < 0 || index >= params.length) throw new RangeError(`Missing SQL parameter ${match[0]}`)
    chunks.push(sql.raw(text.slice(start, match.index)), sql`${sql.param(params[index])}`)
    start = match.index + match[0].length
  }
  chunks.push(sql.raw(text.slice(start)))
  return sql.join(chunks, sql.raw(''))
}

/** Normalise top-level result columns only: Postgres numeric (OID 1700) strings
 * become numbers; timestamp/timestamptz (1114/1184) become UTC ISO strings.
 * Date values are also normalised. JSON, text and opaque string IDs stay intact.
 * pg and the two Drizzle routes all supply the same column metadata.
 */
function normalise<R>(value: unknown): { rows: R[]; rowCount: number } {
  const result = value as Result
  const types = new Map(result.fields?.map(field => [field.name, field.dataTypeID]))
  const rows = result.rows.map(row => Object.fromEntries(Object.entries(row as Record<string, unknown>).map(([key, value]) => {
    const type = types.get(key)
    if (value instanceof Date) value = value.toISOString()
    else if (typeof value === 'string' && type === 1700) value = Number(value)
    else if (typeof value === 'string' && (type === 1114 || type === 1184)) {
      // timestamp without time zone has UTC semantics at this boundary.
      const timestamp = type === 1114 && !/(?:Z|[+-]\d{2}(?::?\d{2})?)$/.test(value) ? `${value}Z` : value
      value = new Date(timestamp).toISOString()
    }
    return [key, value]
  }))) as R[]
  return { rows, rowCount: result.rowCount ?? result.affectedRows ?? rows.length }
}

export function txExecutor(req: PayloadRequest): Executor & { schemaName?: string } {
  const db = req.payload.db as PostgresDatabase
  return {
    schemaName: db.schemaName,
    async query<R>(text: string, params: unknown[] = []) {
      const id = await req.transactionID
      const session = id == null ? undefined : db.sessions?.[id]
      if (!session) throw new XpNoTransactionError()
      return normalise<R>(await (session.db as Database).execute(bind(text, params)))
    },
  }
}

export function pooledExecutor(payload: Payload): Executor & { schemaName?: string } {
  const db = payload.db as PostgresDatabase
  return {
    schemaName: db.schemaName,
    async query<R>(text: string, params: unknown[] = []) {
      return normalise<R>(await (db.drizzle as Database).execute(bind(text, params)))
    },
  }
}

export function pgPoolExecutor(pool: Pool | PoolClient): Executor {
  return { async query<R>(text: string, params: unknown[] = []) { return normalise<R>(await pool.query(text, params)) } }
}

/** The caller must release in finally; this connection never joins a Payload transaction. */
export async function ownConnection(pool: Pool): Promise<Executor & { release(): void }> {
  const client = await pool.connect()
  return { ...pgPoolExecutor(client), release: () => client.release() }
}

export async function withStatementTimeout<T>(pool: Pool, ms: number, fn: (exec: Executor) => Promise<T>): Promise<T> {
  if (!Number.isSafeInteger(ms) || ms < 0) throw new RangeError('statement timeout must be a non-negative integer')
  const exec = await ownConnection(pool)
  try {
    await exec.query('BEGIN')
    await exec.query(`SET LOCAL statement_timeout = ${ms}`)
    const result = await fn(exec)
    await exec.query('COMMIT')
    return result
  } catch (error) {
    try { await exec.query('ROLLBACK') } catch { /* Preserve the original failure. */ }
    throw error
  } finally { exec.release() }
}
