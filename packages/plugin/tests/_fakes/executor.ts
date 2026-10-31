import type { SQL } from '@payloadcms/db-postgres/drizzle'
import { PgDialect } from '@payloadcms/db-postgres/drizzle/pg-core'
import type { Payload, PayloadRequest } from 'payload'
import type { DocId } from '../../src/types/contracts.js'
import { fakePayload } from './payload.js'
import { fakeReq } from './req.js'

/** Plan §2.9; kept structural until CORE-09 creates the production interface. */
export interface Executor {
  query<R>(text: string, params?: unknown[]): Promise<{ rows: R[]; rowCount: number }>
}
export type FakeQueryResult = { rows: unknown[]; rowCount?: number }
export type FakeExecutorCall = { text: string; params: unknown[] }
export type FakeExecutorOptions = {
  results?: FakeQueryResult[]
  /** Calls are one-based; failed calls are logged and do not consume a queued result. */
  throwOn?: number | string | RegExp | { at?: number; match?: string | RegExp; error: unknown }
    | ((call: FakeExecutorCall, callNumber: number) => unknown | undefined)
}
export type FakeSessionOptions = { payload?: Payload; transactionID?: DocId }
export interface FakeExecutor extends Executor {
  calls: FakeExecutorCall[]
  execute<R>(statement: SQL): Promise<{ rows: R[]; rowCount: number }>
  withSession(options?: string | FakeSessionOptions): PayloadRequest
  noSession(): PayloadRequest
}

export function createFakeExecutor({ results = [], throwOn }: FakeExecutorOptions = {}): FakeExecutor {
  const calls: FakeExecutorCall[] = []
  const queue = [...results]
  const dialect = new PgDialect()
  const matches = (text: string, match: string | RegExp) => typeof match === 'string'
    ? text.includes(match) : new RegExp(match.source, match.flags).test(text)
  const executor: FakeExecutor = {
    calls,
    async query<R>(text: string, params: unknown[] = []): Promise<{ rows: R[]; rowCount: number }> {
      const call = { text, params: structuredClone(params) }
      calls.push(call)
      if (typeof throwOn === 'function') {
        const error = throwOn(call, calls.length)
        if (error !== undefined) throw error
      } else if (throwOn && typeof throwOn === 'object' && !(throwOn instanceof RegExp)) {
        if ((throwOn.at === undefined || calls.length === throwOn.at) && (throwOn.match === undefined || matches(text, throwOn.match))) throw throwOn.error
      } else {
        const shouldThrow = typeof throwOn === 'number' ? calls.length === throwOn
          : throwOn !== undefined ? matches(text, throwOn) : false
        if (shouldThrow) throw new Error(`Fake executor failure on call ${calls.length}`)
      }
      const result = queue.shift() ?? { rows: [], rowCount: 0 }
      return { rows: result.rows as R[], rowCount: result.rowCount ?? result.rows.length }
    },
    async execute<R>(statement: SQL): Promise<{ rows: R[]; rowCount: number }> {
      const compiled = dialect.sqlToQuery(statement)
      return executor.query<R>(compiled.sql, compiled.params)
    },
    withSession(options: string | FakeSessionOptions = {}): PayloadRequest {
      const { payload = fakePayload({ executor }), transactionID = 'fake-transaction' } = typeof options === 'string' ? { transactionID: options } : options
      payload.db.sessions ??= {}
      payload.db.sessions[transactionID] = { db: executor, resolve: async () => {}, reject: async () => {} }
      return fakeReq({ payload, transactionID })
    },
    noSession(): PayloadRequest { return fakeReq() },
  }
  return executor
}

export function withSession({ payload, transactionID, ...options }: FakeExecutorOptions & FakeSessionOptions = {}) {
  const executor = createFakeExecutor(options)
  return { executor, req: executor.withSession({ payload, transactionID }) }
}
export function noSession(options: FakeExecutorOptions = {}) {
  const executor = createFakeExecutor(options)
  return { executor, req: executor.noSession() }
}
