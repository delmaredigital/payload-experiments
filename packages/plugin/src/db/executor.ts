import { sql } from '@payloadcms/db-postgres/drizzle'
import type { PostgresAdapter } from '@payloadcms/db-postgres'
import type { Payload, PayloadRequest } from 'payload'
import { XpNoTransactionError } from '../errors.js'
import { normalise, scanParameters } from './pgExecutor.js'
import type { Executor } from './pgExecutor.js'

export type { Executor } from './pgExecutor.js'
export { pgPoolExecutor, ownConnection, withStatementTimeout } from './pgExecutor.js'

type Database = { execute(query: ReturnType<typeof sql.raw>): Promise<unknown> }
type PostgresDatabase = Pick<PostgresAdapter, 'schemaName' | 'drizzle' | 'sessions'>

/** Convert code-only $n placeholders to sql.raw chunks and sql.param values.
 * Repeated/out-of-order placeholders rebind; arrays are always one parameter.
 */
function bind(text: string, params: unknown[]) {
  const chunks: ReturnType<typeof sql.raw>[] = []
  let start = 0
  for (const position of scanParameters(text, params)) {
    chunks.push(sql.raw(text.slice(start, position.start)), sql`${sql.param(params[position.index])}`)
    start = position.end
  }
  chunks.push(sql.raw(text.slice(start)))
  return sql.join(chunks, sql.raw(''))
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
