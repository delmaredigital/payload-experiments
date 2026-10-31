import { sql, type SQL } from '@payloadcms/db-postgres/drizzle'
import { PgDialect } from '@payloadcms/db-postgres/drizzle/pg-core'
import type { CollectionAfterChangeHook, PayloadRequest } from 'payload'
import { afterAll, beforeAll, expect, test, vi } from 'vitest'
import { appendAllocationChange, appendContentChange } from '../../src/db/appends.js'
import { txExecutor } from '../../src/db/executor.js'
import { createPgliteDb } from '../_helpers/pglite.js'
import { users, xp_experiments, xp_phases } from '../_fixtures/generated-schema.js'
import { contentChangesHook } from '../../src/hooks/contentChanges.js'
import { fakePayload } from '../_fakes/payload.js'
import { fakeReq } from '../_fakes/req.js'
import { sampleOptions } from '../collections/fixtures.js'

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
  const content = { at: allocation.at, doc: { collection: 'pages', id: 'opaque-doc' }, by: 5 }
  const nextContent = { at: nextAllocation.at, doc: { collection: 'pages', id: 7 }, by: 'opaque-user' }
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
        await appendContentChange(exec, { ...target, entry: { at: '2026-10-31T00:00:00Z', doc: { collection: 'pages', id: 7 }, by: 5 } })
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

test.each(['discovery read', 'locked read', 'append'])('a real SQL failure in the %s preserves the host save and transaction', async stage => {
  const report = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    const email = stage.replaceAll(' ', '-') + '@host.test'
    await database.db.transaction(async tx => {
      const [doc] = await tx.insert(users).values({ email }).returning()
      const options = sampleOptions()
      options.puck = { enabled: true, collections: ['users'] }
      const [experiment] = await tx.insert(xp_experiments).values({ name: 'Audit target', slug: stage.replaceAll(' ', '-'), kind: 'block', exposurePolicy: 'render', status: 'running', phase: 99 }).returning()
      const payload = fakePayload({ config: { custom: { xp: options } } })
      const find = vi.spyOn(payload, 'find')
      let reads = 0
      const dialect = new PgDialect()
      payload.db.sessions.host = { db: {
        async execute(statement: SQL) {
          const text = dialect.sqlToQuery(statement).sql
          if (text.startsWith('SELECT') && text.includes('FROM')) reads++
          if (stage === 'discovery read' && reads === 1 && text.includes('FROM') ||
              stage === 'locked read' && reads === 2 && text.includes('FROM') ||
              stage === 'append' && text.startsWith('UPDATE')) {
            return tx.execute(sql.raw('SELECT xp_missing_column FROM users'))
          }
          return tx.execute(statement)
        },
      }, resolve: async () => {}, reject: async () => {} }
      const req = fakeReq({ payload, transactionID: 'host' })
      const data = (text: string) => ({ content: [{ type: 'ExperimentSlot', props: { experiment: experiment!.slug, control: [{ text }] } }] })
      const saved = { ...doc!, puckData: data('New') }
      const args = { req, doc: saved, previousDoc: { ...doc!, puckData: data('Old') }, collection: { slug: 'users' } } as Parameters<CollectionAfterChangeHook>[0]
      expect(await contentChangesHook(args)).toBe(saved)
      expect(req.transactionID).toBe('host')
      expect(payload.dbCalls).toEqual([])
      expect(find).not.toHaveBeenCalled()
      // This query fails with "transaction is aborted" unless savepoint recovery worked.
      expect((await tx.select().from(users)).some(user => user.email === email)).toBe(true)
    })
    expect((await database.db.select().from(users)).some(user => user.email === email)).toBe(true)
    expect(report).toHaveBeenCalledOnce()
  } finally {
    report.mockRestore()
  }
})
