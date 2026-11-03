import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import type { Payload, PayloadRequest } from 'payload'
import type { Pool, QueryConfig } from 'pg'
import { describe, expect, test, vi } from 'vitest'
import { ownConnection, pgPoolExecutor, pooledExecutor, txExecutor, withStatementTimeout, ResultsBudgetError } from '../../src/db/executor.js'
import { XpNoTransactionError } from '../../src/errors.js'

function fake() {
  const execute = vi.fn(async (_query: SQL): Promise<unknown> => ({ rows: [], rowCount: 0 }))
  const poolExecute = vi.fn(async (_query: SQL): Promise<unknown> => ({ rows: [], rowCount: 0 }))
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
  test.each([
    'SELECT $a$ inside $$ $2 $a$, $1',
    String.raw`SELECT E'it\'s $2', $1`,
    'SELECT /* outer /* inner $2 */ still $2 */ $1',
    'SELECT col$2, $1',
    'SELECT $1',
  ])('scanner binds only SQL-code placeholders in %s', async text => {
    const f = fake()
    await txExecutor(f.req).query(text, [7])
    const query = compiled(f.execute.mock.calls[0]![0])
    expect(query.params).toEqual([7])
    expect(query.sql).toBe(text)
  })
  test.each(['transaction', 'pool', 'pg'])('%s rejects unused, missing, zero and skipped parameters before executing', async route => {
    const f = fake()
    const query = vi.fn(async () => ({ rows: [] }))
    const exec = route === 'transaction' ? txExecutor(f.req) : route === 'pool' ? pooledExecutor(f.payload) : pgPoolExecutor({ query } as unknown as Pool)
    for (const [text, params] of [
      ['SELECT $1', [1, 2]], ['SELECT 1', [1]], ['SELECT $0', [1]],
      ['SELECT $2', [1, 2]], ['SELECT $2', [1]],
    ] as Array<[string, unknown[]]>) await expect(exec.query(text, params)).rejects.toThrow(RangeError)
    expect(query).not.toHaveBeenCalled()
    expect(f.execute).not.toHaveBeenCalled()
    expect(f.poolExecute).not.toHaveBeenCalled()
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
  const client = { query: vi.fn(async (_query: QueryConfig) => ({ rows: [], rowCount: 0 })), release: vi.fn() }
  return { client, pool: { connect: vi.fn(async () => client) } as unknown as Pool }
}
test('ownConnection uses one checked-out client and exposes release', async () => {
  const { pool, client } = fakePool()
  const exec = await ownConnection(pool)
  try { await exec.query('SELECT $1', [8]) } finally { exec.release() }
  expect(client.query).toHaveBeenCalledWith(expect.objectContaining({ text: 'SELECT $1', values: [8] }))
  expect(client.release).toHaveBeenCalledOnce()
  expect(client.release).toHaveBeenCalledWith(undefined)
})
test('ownConnection releases a failed query with a sanitized error to discard the client', async () => {
  const { pool, client } = fakePool()
  const queryError = new Error('connection lost')
  client.query.mockRejectedValue(queryError)
  const exec = await ownConnection(pool)
  try { await expect(exec.query('SELECT 1')).rejects.toBe(queryError) }
  finally { exec.release() }
  expect(client.release).toHaveBeenCalledExactlyOnceWith(expect.any(Error))
  expect(client.release.mock.calls[0]![0]).toMatchObject({ name: 'Error', message: 'Query failed' })
  expect(JSON.stringify(client.release.mock.calls[0]![0])).not.toContain('connection lost')
})
test.each(['57014', '23505', '42P01'])('ownConnection reuses a client after SQL error %s and successful rollback', async code => {
  const { pool, client } = fakePool()
  const error = Object.assign(new Error('SQL failed'), { code })
  client.query.mockRejectedValueOnce(error)
  const exec = await ownConnection(pool)
  await expect(exec.query('SELECT broken')).rejects.toBe(error)
  await exec.query('ROLLBACK')
  exec.release()
  expect(client.release).toHaveBeenCalledExactlyOnceWith(undefined)
})
test.each(['08006', '08003', '57P01', '57P02', '57P03', 'ECONNRESET', undefined])('ownConnection discards connection failure %s even after rollback', async code => {
  const { pool, client } = fakePool()
  const error = Object.assign(new Error('connection failed'), { code })
  client.query.mockRejectedValueOnce(error)
  const exec = await ownConnection(pool)
  await expect(exec.query('SELECT broken')).rejects.toBe(error)
  await exec.query('ROLLBACK')
  exec.release()
  expect(client.release).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    name: 'Error', message: 'Query failed', ...(code && /^[0-9A-Z]{5}$/.test(code) ? { code } : {}),
  }))
})
test.each([false, true])('timeout executor releases SQL failures normally after rollback (deadline %s)', async bounded => {
  for (const code of ['57014', '23505']) {
    const { pool, client } = fakePool()
    const error = Object.assign(new Error('SQL failed'), { code })
    client.query.mockImplementation(async query => {
      if (query.text === 'SELECT broken') throw error
      return { rows: [], rowCount: 0 }
    })
    const work = withStatementTimeout(pool, 250, exec => exec.query('SELECT broken'), bounded ? Date.now() + 1000 : undefined)
    if (bounded && code === '57014') await expect(work).rejects.toBeInstanceOf(ResultsBudgetError)
    else await expect(work).rejects.toBe(error)
    expect(client.query.mock.calls.at(-1)![0].text).toBe('ROLLBACK')
    expect(client.release).toHaveBeenCalledExactlyOnceWith(undefined)
  }
})
test.each([false, true])('timeout executor discards transport errors (deadline %s)', async bounded => {
  for (const code of ['08006', '57P01', undefined]) {
    const { pool, client } = fakePool()
    const error = Object.assign(new Error('connection failed'), { code })
    client.query.mockRejectedValueOnce(error)
    await expect(withStatementTimeout(pool, 250, async () => {}, bounded ? Date.now() + 1000 : undefined)).rejects.toBe(error)
    expect(client.release).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      name: 'Error', message: 'Query failed', ...(code ? { code } : {}),
    }))
  }
})
test('a bounded failed rollback discards the client while preserving the SQL error', async () => {
  const { pool, client } = fakePool()
  const error = Object.assign(new Error('SQL failed'), { code: '23505' })
  const rollbackError = Object.assign(new Error('rollback failed'), { code: '25P02' })
  client.query.mockImplementation(async query => {
    if (query.text === 'SELECT broken') throw error
    if (query.text === 'ROLLBACK') throw rollbackError
    return { rows: [], rowCount: 0 }
  })
  await expect(withStatementTimeout(pool, 250, exec => exec.query('SELECT broken'), Date.now() + 1000)).rejects.toBe(error)
  expect(client.release).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ name: 'Error', code: '25P02', message: 'Rollback failed' }))
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
  expect(client.query.mock.calls.map(call => call[0].text)).toEqual(['BEGIN', 'SET LOCAL statement_timeout = 250', 'SELECT $1', fail ? 'ROLLBACK' : 'COMMIT'])
  expect(client.release).toHaveBeenCalledOnce()
})
test.each([0, -1, 1.5, Infinity])('invalid statement timeout %s is rejected before checking out a connection', async ms => {
  const { pool } = fakePool()
  await expect(withStatementTimeout(pool, ms, async () => {})).rejects.toThrow(RangeError)
  expect(pool.connect).not.toHaveBeenCalled()
})

test('a failed rollback destroys the connection while preserving the work error', async () => {
  const { pool, client } = fakePool()
  const rollbackError = new Error('rollback failed')
  const workError = new Error('work failed')
  client.query.mockImplementation(async query => {
    if (query.text === 'ROLLBACK') throw rollbackError
    return { rows: [], rowCount: 0 }
  })
  await expect(withStatementTimeout(pool, 250, async () => { throw workError })).rejects.toBe(workError)
  expect(client.release).toHaveBeenCalledWith(expect.objectContaining({ name: 'Error', message: 'Rollback failed' }))
})

test.each(['transaction', 'pool', 'pg'])('%s always returns numbers for finite numeric/safe int8, preserving nulls and infinite timestamps', async route => {
  const values = ['3', '9007199254740991', '-9007199254740991', 3n, '12345678901234567890', '12.3333333333333333', '0.10000000000000000001', '12.500', '1.25e-2', null, null, 'infinity', '-infinity', '2026-10-30 12:00:00']
  const oids = [20, 20, 20, 20, 1700, 1700, 1700, 1700, 1700, 20, 1700, 1184, 1114, 1114]
  const returned = { rows: [Object.fromEntries(values.map((v, i) => [`v${i}`, v]))], rowCount: 1, fields: oids.map((dataTypeID, i) => ({ name: `v${i}`, dataTypeID })) }
  const f = fake()
  f.execute.mockResolvedValue(returned)
  f.poolExecute.mockResolvedValue(returned)
  const query = vi.fn(async () => returned)
  const exec = route === 'transaction' ? txExecutor(f.req) : route === 'pool' ? pooledExecutor(f.payload) : pgPoolExecutor({ query } as unknown as Pool)
  const expected = [3, Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER, 3, Number('12345678901234567890'), 12.333333333333334, 0.1, 12.5, 0.0125, null, null, 'infinity', '-infinity', '2026-10-30T12:00:00.000Z']
  expect((await exec.query('SELECT values')).rows).toEqual([Object.fromEntries(expected.map((v, i) => [`v${i}`, v]))])
})

test.each(['transaction', 'pool', 'pg'])('%s throws on invalid/non-finite numeric or unsafe int8', async route => {
  for (const [value, oid] of [
    ['9007199254740992', 20], ['-9007199254740992', 20], [9007199254740993n, 20],
    ['1.5', 20], ['invalid', 20], ['1e400', 1700], ['NaN', 1700], ['Infinity', 1700],
    ['-Infinity', 1700], ['invalid', 1700], ['', 1700], [' ', 1700], ['0x10', 1700], [Infinity, 1700], [NaN, 1700],
  ] as const) {
    const returned = { rows: [{ value }], fields: [{ name: 'value', dataTypeID: oid }] }
    const f = fake()
    f.execute.mockResolvedValue(returned)
    f.poolExecute.mockResolvedValue(returned)
    const query = vi.fn(async () => returned)
    const exec = route === 'transaction' ? txExecutor(f.req) : route === 'pool' ? pooledExecutor(f.payload) : pgPoolExecutor({ query } as unknown as Pool)
    await expect(exec.query('SELECT value')).rejects.toThrow(RangeError)
  }
})

test('pg installs per-query raw parsers so timestamp values cannot be interpreted in local time', async () => {
  const { pool, client } = fakePool()
  await (await ownConnection(pool)).query('SELECT 1')
  const parser = client.query.mock.calls[0]![0].types!.getTypeParser
  for (const oid of [20, 1700, 1114, 1184]) expect(parser(oid)('2026-10-30 12:00:00')).toBe('2026-10-30 12:00:00')
  expect(parser(3802)('{"n":"123"}')).toEqual({ n: '123' })
})
