import type { Payload, PayloadRequest } from 'payload'
import { expect, test } from 'vitest'
import { pooledExecutor, txExecutor } from '../../src/db/executor.js'
import { currentTxid, txidStatus } from '../../src/db/txid.js'
import { createPgliteDb } from '../_helpers/pglite.js'

test('txid_status identifies the captured transaction as committed after commit', async () => {
  const { db, close } = await createPgliteDb()
  try {
    const xid = await db.transaction(async tx => {
      const req = { transactionID: 'tx', payload: { db: { sessions: { tx: { db: tx } } } } } as unknown as PayloadRequest
      const exec = txExecutor(req)
      const xid = await currentTxid(exec)
      expect(xid).toMatch(/^\d+$/)
      expect(await txidStatus(exec, xid)).toBe('in progress')
      return xid
    })
    const pooled = pooledExecutor({ db: { drizzle: db } } as unknown as Payload)
    expect(await txidStatus(pooled, xid)).toBe('committed')
  } finally { await close() }
}, 60_000)
