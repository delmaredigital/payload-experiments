import { fakePayload } from './payload.js'
import { fakeReq } from './req.js'

/** Plan §2.9; kept structural until CORE-09 creates the production interface. */
export interface Executor {
  query<R>(text: string, params?: unknown[]): Promise<{ rows: R[]; rowCount: number }>
}
export type FakeQueryResult = { rows: unknown[]; rowCount?: number }
export type FakeExecutorOptions = { results?: FakeQueryResult[]; throwOn?: number | string | RegExp }

export function createFakeExecutor({ results = [], throwOn }: FakeExecutorOptions = {}) {
  const calls: Array<{ text: string; params: unknown[] }> = []
  const queue = [...results]
  const dialect = new PgDialect()
  const executor = {
    calls,
    async query<R>(text: string, params: unknown[] = []): Promise<{ rows: R[]; rowCount: number }> {
      calls.push({ text, params: [...params] })
      const shouldThrow = typeof throwOn === 'number' ? calls.length === throwOn
        : typeof throwOn === 'string' ? text.includes(throwOn)
        : throwOn instanceof RegExp ? new RegExp(throwOn.source, throwOn.flags).test(text) : false
      if (shouldThrow) throw new Error(`Fake executor failure on call ${calls.length}`)
      const result = queue.shift() ?? { rows: [], rowCount: 0 }
      return { rows: result.rows as R[], rowCount: result.rowCount ?? result.rows.length }
    },
    async execute<R>(statement: SQL): Promise<{ rows: R[]; rowCount: number }> {
      const compiled = dialect.sqlToQuery(statement)
      return executor.query<R>(compiled.sql, compiled.params)
    },
    withSession(transactionID = 'fake-transaction'): PayloadRequest {
      const payload = fakePayload()
      payload.db.sessions[transactionID] = { db: executor, resolve: async () => {}, reject: async () => {} }
      return fakeReq({ payload, transactionID })
    },
    noSession(): PayloadRequest { return fakeReq() },
  } satisfies Executor & Record<string, unknown>
  return executor
}

export function withSession(options: FakeExecutorOptions = {}) {
  const executor = createFakeExecutor(options)
  return { executor, req: executor.withSession() }
}
export function noSession(options: FakeExecutorOptions = {}) {
  const executor = createFakeExecutor(options)
  return { executor, req: executor.noSession() }
}
import type { SQL } from '@payloadcms/db-postgres/drizzle'
import { PgDialect } from '@payloadcms/db-postgres/drizzle/pg-core'
import type { PayloadRequest } from 'payload'
