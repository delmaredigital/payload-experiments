import type { PayloadRequest } from 'payload'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { appendAllocationChange, appendContentChange } from '../../src/db/appends.js'
import { txExecutor } from '../../src/db/executor.js'
import { createPgliteDb } from '../_helpers/pglite.js'
import { xp_experiments, xp_phases } from '../_fixtures/generated-schema.js'

let database: Awaited<ReturnType<typeof createPgliteDb>>
let experimentId: number
let otherId: number
beforeAll(async () => {
  database = await createPgliteDb()
  const experiments = await database.db.insert(xp_experiments).values([
    { name: 'Target', slug: 'target', kind: 'code', exposurePolicy: 'manual' },
    { name: 'Other', slug: 'other', kind: 'code', exposurePolicy: 'manual' },
  ]).returning()
  experimentId = experiments[0]!.id
  otherId = experiments[1]!.id
  await database.db.insert(xp_phases).values([
    { experiment: experimentId, phase: 1, phaseKind: 'test', seed: 'seed|', startedAt: '2026-10-30T00:00:00Z' },
    { experiment: experimentId, phase: 2, phaseKind: 'test', seed: 'seed2|', startedAt: '2026-10-30T00:00:00Z' },
    { experiment: otherId, phase: 1, phaseKind: 'test', seed: 'other|', startedAt: '2026-10-30T00:00:00Z' },
  ])
}, 60_000)
afterAll(async () => { await database?.close() })

test('both JSONB columns append to null then existing arrays; only target phase changes', async () => {
  const before = await database.db.select().from(xp_phases)
  const allocation = { at: '2026-10-30T01:00:00Z', from: 25, to: 50 }
  const nextAllocation = { at: '2026-10-30T02:00:00Z', from: 50, to: 75 }
  const content = { at: allocation.at, doc: 'opaque-doc', by: 5 }
  const nextContent = { at: nextAllocation.at, doc: 7, by: 'opaque-user' }
  await database.db.transaction(async tx => {
    const req = { transactionID: 'tx', payload: { db: { sessions: { tx: { db: tx } } } } } as unknown as PayloadRequest
    const exec = txExecutor(req)
    await appendAllocationChange(exec, { experimentId, phase: 1, entry: allocation })
    await appendContentChange(exec, { experimentId, phase: 1, entry: content })
    const target = (await tx.select().from(xp_phases)).find(row => row.experiment === experimentId && row.phase === 1)!
    expect(target.allocationChanges).toEqual([allocation])
    expect(target.contentChanges).toEqual([content])
    await appendAllocationChange(exec, { experimentId, phase: 1, entry: nextAllocation })
    await appendContentChange(exec, { experimentId, phase: 1, entry: nextContent })
  })
  const after = await database.db.select().from(xp_phases)
  for (const row of after) {
    const original = before.find(value => value.id === row.id)!
    expect(row).toEqual(row.experiment === experimentId && row.phase === 1
      ? { ...original, allocationChanges: [allocation, nextAllocation], contentChanges: [content, nextContent] }
      : original)
  }
})

test.each(['allocation', 'content'] as const)('%s append refuses missing phase rows with 404 and changes nothing', async kind => {
  const before = await database.db.select().from(xp_phases)
  for (const target of [{ experimentId, phase: 99 }, { experimentId: otherId, phase: 2 }]) {
    await expect(database.db.transaction(async tx => {
      const req = { transactionID: 'tx', payload: { db: { sessions: { tx: { db: tx } } } } } as unknown as PayloadRequest
      const exec = txExecutor(req)
      if (kind === 'allocation') {
        await appendAllocationChange(exec, { ...target, entry: { at: '2026-10-31T00:00:00Z', from: 1, to: 2 } })
      } else {
        await appendContentChange(exec, { ...target, entry: { at: '2026-10-31T00:00:00Z', doc: 7, by: 5 } })
      }
    })).rejects.toMatchObject({ code: 'not-found', status: 404, detail: target })
  }
  expect(await database.db.select().from(xp_phases)).toEqual(before)
})

test('SQL appends roll back atomically with their caller transaction', async () => {
  const before = await database.db.select().from(xp_phases)
  const error = new Error('abort')
  await expect(database.db.transaction(async tx => {
    const req = { transactionID: 'tx', payload: { db: { sessions: { tx: { db: tx } } } } } as unknown as PayloadRequest
    await appendAllocationChange(txExecutor(req), { experimentId: otherId, phase: 1, entry: { at: 'now', from: 1, to: 2 } })
    throw error
  })).rejects.toBe(error)
  expect(await database.db.select().from(xp_phases)).toEqual(before)
})
