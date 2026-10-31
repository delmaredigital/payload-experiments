import type { Payload, PayloadRequest } from 'payload'
import { expect, test, vi } from 'vitest'
import { eraseUserRows } from '../../src/db/erase.js'
import { eraseUser } from '../../src/server/eraseUser.js'
import { insertEvents, type EventRow } from '../../src/db/events.js'
import { insertIdentity } from '../../src/db/identities.js'
import { pooledExecutor, txExecutor } from '../../src/db/executor.js'
import { createPgliteDb } from '../_helpers/pglite.js'

test('erase removes all three event branches and only the target identities in one transaction', async () => {
  const { db, close } = await createPgliteDb()
  try {
    const exec = pooledExecutor({ db: { drizzle: db } } as unknown as Payload)
    await insertIdentity(exec, { anonymousId: 'linked', userId: 'user' })
    await insertIdentity(exec, { anonymousId: 'other-linked', userId: 'other' })
    await insertIdentity(exec, { anonymousId: 'linked', userId: 'other' })
    const base: EventRow = { type: 'conversion', unitId: 'visitor', unitType: 'visitor', dedupeKey: 'direct', userId: 'user', ts: new Date().toISOString() }
    await insertEvents(exec, [base, { ...base, dedupeKey: 'user-unit', userId: undefined, unitId: 'user', unitType: 'user' },
      { ...base, dedupeKey: 'linked', userId: undefined, unitId: 'linked' },
      { ...base, dedupeKey: 'other', userId: 'other', unitId: 'other-linked' },
      { ...base, dedupeKey: 'visitor-same-id', userId: undefined, unitId: 'user' }])
    await db.transaction(async tx => {
      const req = { payload: { db: { sessions: { own: { db: tx } } } }, transactionID: 'own' } as unknown as PayloadRequest
      expect(await eraseUserRows(txExecutor(req), 'user')).toEqual({ identities: 1, events: 3 })
    })
    expect((await exec.query('SELECT dedupe_key FROM xp_events ORDER BY dedupe_key')).rows).toEqual([{ dedupe_key: 'other' }, { dedupe_key: 'visitor-same-id' }])
    expect((await exec.query('SELECT anonymous_id, user_id FROM xp_identities')).rows).toEqual([{ anonymous_id: 'other-linked', user_id: 'other' }])
  } finally { await close() }
}, 60_000)

test('eraseUser owns commit/rollback and stringifies user ids', async () => {
  const execute = vi.fn().mockResolvedValue({ rows: [] })
  const beginTransaction = vi.fn().mockResolvedValue('own')
  const commitTransaction = vi.fn()
  const rollbackTransaction = vi.fn()
  const verify = vi.fn().mockResolvedValue({ rows: [{ remaining: false }] })
  const payload = { db: { drizzle: { execute: verify }, beginTransaction, commitTransaction, rollbackTransaction, sessions: { own: { db: { execute } } } } } as unknown as Payload
  expect(await eraseUser(payload, { userId: 42 as unknown as string })).toEqual({ identities: 0, events: 0 })
  expect(JSON.stringify(execute.mock.calls[0])).toContain('42')
  expect(commitTransaction).toHaveBeenCalledWith('own')
  expect(rollbackTransaction).not.toHaveBeenCalled()
  execute.mockRejectedValue(new Error('delete failed'))
  await expect(eraseUser(payload, { userId: 'user' })).rejects.toThrow('delete failed')
  expect(rollbackTransaction).toHaveBeenCalledWith('own')
  beginTransaction.mockResolvedValue(null)
  await expect(eraseUser(payload, { userId: 'user' })).rejects.toThrow('requires a transaction')
})

test('eraseUser rejects a swallowed commit failure when linked visitor events remain', async () => {
  const execute = vi.fn().mockResolvedValueOnce({ rows: [{ anonymousId: 'linked' }] }).mockResolvedValue({ rows: [{ id: 1 }] })
  const verify = vi.fn().mockResolvedValue({ rows: [{ remaining: true }] })
  const payload = { db: { beginTransaction: async () => 'own', commitTransaction: async () => undefined,
    rollbackTransaction: vi.fn(), sessions: { own: { db: { execute } } }, drizzle: { execute: verify } } } as unknown as Payload
  await expect(eraseUser(payload, { userId: 'user' })).rejects.toThrow('commit unverified')
  expect(JSON.stringify(verify.mock.calls)).toContain('linked')
})
