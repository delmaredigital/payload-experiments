import type { Payload, PayloadRequest } from 'payload'
import { expect, test } from 'vitest'
import { pooledExecutor, txExecutor } from '../../src/db/executor.js'
import { createPgliteDb } from '../_helpers/pglite.js'

test('real numeric/timestamptz columns normalise identically on pool and transaction routes', async () => {
  const { db, close } = await createPgliteDb()
  try {
    const payload = { db: { drizzle: db } } as unknown as Payload
    const pooled = pooledExecutor(payload)
    await pooled.query('INSERT INTO xp_state (revision, created_at, updated_at) VALUES ($1, $2, $2)', [12.5, '2026-10-30T10:30:00+02:00'])
    const query = 'SELECT revision, created_at FROM xp_state'
    const expected = { rows: [{ revision: 12.5, created_at: '2026-10-30T08:30:00.000Z' }], rowCount: 1 }
    expect(await pooled.query(query)).toEqual(expected)
    await db.transaction(async tx => {
      const req = { transactionID: Promise.resolve('tx'), payload: { db: { sessions: { tx: { db: tx } } } } } as unknown as PayloadRequest
      expect(await txExecutor(req).query(query)).toEqual(expected)
      expect((await txExecutor(req).query('SELECT $1::text[] AS values', [['a', 'b']])).rows).toEqual([{ values: ['a', 'b'] }])
    })
  } finally { await close() }
}, 60_000)
