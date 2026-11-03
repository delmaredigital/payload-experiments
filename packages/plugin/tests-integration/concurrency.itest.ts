import { commitTransaction, createLocalReq, initTransaction, killTransaction, type PayloadRequest } from 'payload'
import { afterAll, beforeAll, expect, test, vi } from 'vitest'
import { txExecutor, type Executor } from '../src/db/executor.js'
import { claimSlices } from '../src/db/slices.js'
import * as txids from '../src/db/txid.js'
import { buildAndStoreManifest } from '../src/manifest/compile.js'
import { withTransition, type TransitionScope } from '../src/transitions/kernel.js'
import { writePhaseRecord } from '../src/transitions/phaseRecord.js'
import type { DocId } from '../src/types/contracts.js'
import { createIntegrationHarness } from './harness.js'

// Train-only. The harness and Payload adapter each use max: 6, leaving enough
// connections for two sessions, the lock observer and Payload's retained client.
let harness: Awaited<ReturnType<typeof createIntegrationHarness>>
beforeAll(async () => { harness = await createIntegrationHarness() }, 60_000)
afterAll(async () => { await harness?.teardown() })

function barrier() {
  let release!: () => void
  const promise = new Promise<void>(resolve => { release = resolve })
  return { promise, release }
}
async function session() {
  const req = await createLocalReq({}, harness.payload)
  await initTransaction(req)
  const pid = (await txExecutor(req).query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid
  return { req, pid }
}
async function run<T>(req: PayloadRequest, scope: TransitionScope, fn: (ctx: { exec: Executor; req: PayloadRequest }) => Promise<T>) {
  // These tests own the outer transaction so the observer can obtain B's pid
  // before B blocks on its first lock. The kernel must borrow this transaction.
  try {
    const result = await withTransition(req, scope, fn)
    await commitTransaction(req)
    return result
  } catch (error) {
    await killTransaction(req)
    throw error
  }
}
async function observeWait(pid: number, pending: Promise<unknown>) {
  let finished = false
  void pending.then(() => { finished = true }, () => { finished = true })
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    const { rows } = await harness.pool.query<{ waiting: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM pg_locks WHERE pid = $1 AND locktype = 'advisory' AND NOT granted) AS waiting", [pid],
    )
    if (rows[0]!.waiting) return
    if (finished) throw new Error('Second operation finished without an observed advisory-lock wait')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('Second operation did not wait in pg_locks')
}

const arms = [
  { key: 'control' as const, kind: 'control' as const, label: 'Original', slot: 'control' as const, weight: 50 },
  { key: 'variantA' as const, kind: 'variant' as const, label: 'Variant A', slot: 'variantA' as const, weight: 50 },
]
const seed = '0123456789abcdef0123456789abcdef|'
let serial = 0
async function experiment(layerId?: DocId) {
  const req = await createLocalReq({ context: { xpTransition: true } }, harness.payload)
  const slug = `kernel-${++serial}`
  return harness.payload.create({ collection: 'xp-experiments', req, overrideAccess: true, data: {
    name: slug, slug, kind: 'block', status: 'draft', unitType: 'visitor', exposurePolicy: 'render', arms,
    ...(layerId == null ? {} : { layer: layerId }),
  } })
}
async function start(req: PayloadRequest, experimentId: DocId, slices: number[]) {
  await harness.payload.update({ collection: 'xp-experiments', id: experimentId, req, overrideAccess: true,
    data: { status: 'running', phase: 1, seed, layerSlices: slices, allocation: slices.length || 100 },
  })
  await writePhaseRecord(req, { experiment: experimentId, phase: 1, phaseKind: 'test', seed, arms,
    allocation: slices.length || 100, targeting: [], startedAt: new Date().toISOString(),
    analysis: { sequentialTuningParameter: 5000 },
  })
}

test('two starts in one layer wait, then claim disjoint slices', async () => {
  const layer = await harness.payload.create({ collection: 'xp-layers', overrideAccess: true,
    data: { name: 'Kernel layer', slug: 'kernel-layer', unitType: 'visitor' },
  })
  const a = await experiment(layer.id), b = await experiment(layer.id)
  const first = await session(), second = await session()
  const entered = barrier(), release = barrier()
  let aRun: Promise<unknown> | undefined, bRun: Promise<unknown> | undefined
  let bEntered = false
  let aSlices: number[] = [], bSlices: number[] = []
  try {
    aRun = run(first.req, { experimentId: a.id, layerId: layer.id }, async ({ exec, req }) => {
      aSlices = await claimSlices(exec, { layerId: layer.id, experimentId: a.id, count: 60 })
      await start(req, a.id, aSlices)
      entered.release()
      await release.promise
    })
    await Promise.race([entered.promise, aRun.then(() => { throw new Error('A missed barrier') })])
    bRun = run(second.req, { experimentId: b.id, layerId: layer.id }, async ({ exec, req }) => {
      bEntered = true
      bSlices = await claimSlices(exec, { layerId: layer.id, experimentId: b.id, count: 40 })
      await start(req, b.id, bSlices)
    })
    await observeWait(second.pid, bRun)
    expect(bEntered).toBe(false)
    release.release()
    await Promise.all([aRun, bRun])
    expect(aSlices).toHaveLength(60)
    expect(bSlices).toHaveLength(40)
    expect(aSlices.filter(slice => bSlices.includes(slice))).toEqual([])
  } finally {
    release.release()
    await Promise.allSettled([aRun, bRun])
    await Promise.all([killTransaction(first.req), killTransaction(second.req)])
  }
})

test('two operations on one flag point serialize before entering the callback', async () => {
  const a = await experiment(), b = await experiment()
  const first = await session(), second = await session()
  const entered = barrier(), release = barrier()
  let aRun: Promise<unknown> | undefined, bRun: Promise<unknown> | undefined
  let bEntered = false
  try {
    aRun = run(first.req, { experimentId: a.id, flagPointId: 'same-point' }, async () => {
      entered.release()
      await release.promise
    })
    await Promise.race([entered.promise, aRun.then(() => { throw new Error('A missed barrier') })])
    bRun = run(second.req, { experimentId: b.id, flagPointId: 'same-point' }, async () => { bEntered = true })
    await observeWait(second.pid, bRun)
    expect(bEntered).toBe(false)
    release.release()
    await Promise.all([aRun, bRun])
    expect(bEntered).toBe(true)
  } finally {
    release.release()
    await Promise.allSettled([aRun, bRun])
    await Promise.all([killTransaction(first.req), killTransaction(second.req)])
  }
})

test('two concurrent kernel bumps both advance revision under the state lock', async () => {
  const a = await experiment(), b = await experiment()
  const first = await session(), second = await session()
  const release = barrier(), bumped = barrier()
  let aRun: Promise<{ revision?: number }> | undefined, bRun: Promise<{ revision?: number }> | undefined
  try {
    // Keep A's outer transaction open after the kernel builds its manifest.
    aRun = (async () => {
      const result = await withTransition(first.req, { experimentId: a.id }, async () => null)
      bumped.release()
      await release.promise
      await commitTransaction(first.req)
      return result
    })()
    await Promise.race([bumped.promise, aRun.then(() => { throw new Error('A missed barrier') })])
    bRun = run(second.req, { experimentId: b.id }, async () => null)
    await observeWait(second.pid, bRun)
    release.release()
    const [one, two] = await Promise.all([aRun, bRun])
    expect(two.revision).toBe(one.revision! + 1)
    const state = await harness.pool.query<{ revision: string }>(`SELECT revision FROM "${harness.schemaName}".xp_state`)
    expect(Number(state.rows[0]!.revision)).toBe(two.revision)
  } finally {
    release.release()
    await Promise.allSettled([aRun, bRun])
    await Promise.all([killTransaction(first.req), killTransaction(second.req)])
  }
})

test('throw after a manifest bump leaves revision and manifest untouched', async () => {
  const a = await experiment()
  const { req } = await session()
  const query = `SELECT revision, manifest FROM "${harness.schemaName}".xp_state`
  const before = (await harness.pool.query(query)).rows
  const error = new Error('abort after bump')
  try {
    await expect(withTransition(req, { experimentId: a.id }, async ({ req }) => {
      await start(req, a.id, [])
      // Inject failure after real bump + write, before the kernel could commit.
      await buildAndStoreManifest(req)
      throw error
    })).rejects.toBe(error)
    expect((await harness.pool.query(query)).rows).toEqual(before)
    const doc = await harness.payload.findByID({ collection: 'xp-experiments', id: a.id, overrideAccess: true })
    expect(doc.status).toBe('draft')
  } finally { await killTransaction(req) }
})

test('kernel opens and commits its own transaction and verifies its exact txid on the pool', async () => {
  const a = await experiment()
  const req = await createLocalReq({}, harness.payload)
  expect(req.transactionID).toBeUndefined()
  const status = vi.spyOn(txids, 'txidStatus')
  try {
    const result = await withTransition(req, { experimentId: a.id }, async ({ req }) => {
      expect(req.transactionID).toBeDefined()
      await start(req, a.id, [])
      return a.id
    })
    expect(result.result).toBe(a.id)
    expect(req.transactionID).toBeUndefined()
    expect(status).toHaveBeenCalledOnce()
    const [exec, xid] = status.mock.calls[0]!
    expect(await status.mock.results[0]!.value).toBe('committed')
    expect(await exec.query('SELECT 1 AS pooled')).toMatchObject({ rows: [{ pooled: 1 }] })
    const committed = await harness.pool.query<{ status: string }>('SELECT txid_status($1::bigint) AS status', [xid])
    expect(committed.rows[0]!.status).toBe('committed')
    const state = await harness.pool.query<{ revision: string }>(`SELECT revision FROM "${harness.schemaName}".xp_state`)
    expect(Number(state.rows[0]!.revision)).toBe(result.revision)
    const doc = await harness.payload.findByID({ collection: 'xp-experiments', id: a.id, overrideAccess: true })
    expect(doc.status).toBe('running')
  } finally {
    status.mockRestore()
    await killTransaction(req)
  }
})
