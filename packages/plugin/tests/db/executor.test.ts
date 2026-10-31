import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import type { Payload, PayloadRequest } from 'payload'
import type { Pool } from 'pg'
import { describe, expect, test, vi } from 'vitest'
import { ownConnection, pgPoolExecutor, pooledExecutor, txExecutor, withStatementTimeout } from '../../src/db/executor.js'
import { XpNoTransactionError } from '../../src/errors.js'

function fake() {
  const execute = vi.fn(async (_query: SQL) => ({ rows: [], rowCount: 0 }))
  const poolExecute = vi.fn(async (_query: SQL) => ({ rows: [], rowCount: 0 }))
  const payload = { db: { sessions: { tx: { db: { execute } } }, drizzle: { execute: poolExecute } } } as unknown as Payload
  return { execute, poolExecute, payload, req: { payload, transactionID: 'tx' } as PayloadRequest }
}
const compiled = (query: SQL) => new PgDialect().sqlToQuery(query)

describe('Drizzle executors', () => {
  test.each(['transaction', 'pool'])('%s binds out-of-order and repeated placeholders, including arrays', async route => {
    const f = fake()
    const exec = route === 'transaction' ? txExecutor(f.req) : pooledExecutor(f.payload)
    await exec.query('SELECT $2, $1, $2, $3::text[]', ['a', 42, ['x', 'y']])
    const query = compiled((route === 'transaction' ? f.execute : f.poolExecute).mock.calls[0]![0])
    expect(query.sql).toBe('SELECT $1, $2, $3, $4::text[]')
    expect(query.params).toEqual([42, 'a', 42, ['x', 'y']])
    expect(route === 'transaction' ? f.poolExecute : f.execute).not.toHaveBeenCalled()
  })
  test('does not bind placeholders inside quotes, comments or dollar strings', async () => {
    const f = fake()
    await txExecutor(f.req).query(`SELECT '$1', "$2", $$ $2 $$, $body$ $2 $body$, $1 -- $2\n/* $2 */`, [7])
    expect(compiled(f.execute.mock.calls[0]![0]).params).toEqual([7])
  })
  test('rejects absent positional parameters', async () => {
    const f = fake()
    await expect(txExecutor(f.req).query('SELECT $2', [1])).rejects.toThrow(RangeError)
    expect(f.execute).not.toHaveBeenCalled()
  })
  test.each([undefined, null, 'missing'])('missing transaction %s never falls back to pool', async transactionID => {
    const f = fake()
    // Exercise null from a disabled adapter as well as the declared request types.
    Object.assign(f.req, { transactionID })
    await expect(txExecutor(f.req).query('SELECT 1')).rejects.toBeInstanceOf(XpNoTransactionError)
    expect(f.poolExecute).not.toHaveBeenCalled()
  })
  test('awaits a promised transaction id', async () => {
    const f = fake()
    f.req.transactionID = Promise.resolve('tx')
    await txExecutor(f.req).query('SELECT 1')
    expect(f.execute).toHaveBeenCalledOnce()
  })
  test('metadata converts numeric and timestamp columns without changing JSON or text', async () => {
    const pool = { query: vi.fn(async () => ({
      rows: [{ amount: '12.5', id: '123', ts: '2026-10-30 12:00:00+02', local: '2026-10-30 12:00:00', date: new Date('2026-10-30Z'), json: { n: '2', ts: '2026-10-30' } }], rowCount: 1,
      fields: [{ name: 'amount', dataTypeID: 1700 }, { name: 'id', dataTypeID: 1043 }, { name: 'ts', dataTypeID: 1184 }, { name: 'local', dataTypeID: 1114 }, { name: 'json', dataTypeID: 3802 }],
    })) } as unknown as Pool
    expect(await pgPoolExecutor(pool).query('SELECT')).toEqual({ rows: [{ amount: 12.5, id: '123', ts: '2026-10-30T10:00:00.000Z', local: '2026-10-30T12:00:00.000Z', date: '2026-10-30T00:00:00.000Z', json: { n: '2', ts: '2026-10-30' } }], rowCount: 1 })
  })
})

function fakePool() {
  const client = { query: vi.fn(async (_text: string, _params?: unknown[]) => ({ rows: [], rowCount: 0 })), release: vi.fn() }
  return { client, pool: { connect: vi.fn(async () => client) } as unknown as Pool }
}
test('ownConnection uses one checked-out client and exposes release', async () => {
  const { pool, client } = fakePool()
  const exec = await ownConnection(pool)
  try { await exec.query('SELECT $1', [8]) } finally { exec.release() }
  expect(client.query).toHaveBeenCalledWith('SELECT $1', [8])
  expect(client.release).toHaveBeenCalledOnce()
})
test.each([false, true])('timeout transaction releases on success/failure (%s)', async fail => {
  const { pool, client } = fakePool()
  const work = withStatementTimeout(pool, 250, async exec => {
    await exec.query('SELECT $1', [8])
    if (fail) throw new Error('work failed')
    return 9
  })
  if (fail) await expect(work).rejects.toThrow('work failed')
  else await expect(work).resolves.toBe(9)
  expect(client.query.mock.calls.map(call => call[0])).toEqual(['BEGIN', 'SET LOCAL statement_timeout = 250', 'SELECT $1', fail ? 'ROLLBACK' : 'COMMIT'])
  expect(client.release).toHaveBeenCalledOnce()
})
test('invalid statement timeout is rejected before checking out a connection', async () => {
  const { pool } = fakePool()
  await expect(withStatementTimeout(pool, 1.5, async () => {})).rejects.toThrow(RangeError)
  expect(pool.connect).not.toHaveBeenCalled()
})
