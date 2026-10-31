import type { Payload, PayloadRequest } from 'payload'
import { expect, test } from 'vitest'
import { pooledExecutor, txExecutor } from '../../src/db/executor.js'
import { createPgliteDb } from '../_helpers/pglite.js'

test('real numeric/timestamptz columns normalise identically on pool and transaction routes', async () => {
  const { db, client, close } = await createPgliteDb()
  try {
    // Match pg's raw numeric transport. PGlite otherwise parses numeric with
    // parseFloat before the executor gets it, irreversibly losing precision.
    client.parsers[1700] = value => value
    client.parsers[20] = value => value
    const payload = { db: { drizzle: db } } as unknown as Payload
    const pooled = pooledExecutor(payload)
    await pooled.query('INSERT INTO xp_state (revision, created_at, updated_at) VALUES ($1, $2, $2)', [12.5, '2026-10-30T10:30:00+02:00'])
    const query = 'SELECT revision, created_at FROM xp_state'
    const expected = { rows: [{ revision: 12.5, created_at: '2026-10-30T08:30:00.000Z' }], rowCount: 1 }
    expect(await pooled.query(query)).toEqual(expected)
    const aggregates = 'SELECT count(*) AS count, max(revision) AS amount, 12345678901234567890::numeric AS large, 0.10000000000000000001::numeric AS precise, \'infinity\'::timestamptz AS infinite, \'2026-10-30 12:00:00\'::timestamp AS local FROM xp_state'
    const aggregateExpected = { rows: [{ count: 1, amount: 12.5, large: Number('12345678901234567890'), precise: 0.1, infinite: 'infinity', local: '2026-10-30T12:00:00.000Z' }], rowCount: 1 }
    expect(await pooled.query(aggregates)).toEqual(aggregateExpected)
    const average = 'SELECT avg(value) AS mean FROM (VALUES (12::numeric), (12::numeric), (13::numeric)) AS samples(value)'
    expect((await client.query(average)).rows).toEqual([{ mean: '12.3333333333333333' }])
    const averageExpected = { rows: [{ mean: Number('12.3333333333333333') }], rowCount: 1 }
    expect(await pooled.query(average)).toEqual(averageExpected)
    await expect(pooled.query('SELECT 9007199254740992::int8 AS unsafe')).rejects.toThrow('safe integer range')
    await db.transaction(async tx => {
      const req = { transactionID: Promise.resolve('tx'), payload: { db: { sessions: { tx: { db: tx } } } } } as unknown as PayloadRequest
      expect(await txExecutor(req).query(query)).toEqual(expected)
      expect(await txExecutor(req).query(aggregates)).toEqual(aggregateExpected)
      expect(await txExecutor(req).query(average)).toEqual(averageExpected)
      await expect(txExecutor(req).query('SELECT 9007199254740992::int8 AS unsafe')).rejects.toThrow('safe integer range')
      expect((await txExecutor(req).query('SELECT $1::text[] AS values', [['a', 'b']])).rows).toEqual([{ values: ['a', 'b'] }])
    })
  } finally { await close() }
}, 60_000)
