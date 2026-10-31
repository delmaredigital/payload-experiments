import type { PayloadRequest } from 'payload'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { txExecutor } from '../../src/db/executor.js'
import { claimSlices } from '../../src/db/slices.js'
import { createPgliteDb } from '../_helpers/pglite.js'
import { xp_experiments, xp_layers } from '../_fixtures/generated-schema.js'

let database: Awaited<ReturnType<typeof createPgliteDb>>
let layerId: number
let ownId: number
beforeAll(async () => {
  database = await createPgliteDb()
  const layers = await database.db.insert(xp_layers).values([
    { name: 'Layer', slug: 'layer', unitType: 'visitor' },
    { name: 'Other', slug: 'other', unitType: 'visitor' },
  ]).returning()
  layerId = layers[0]!.id
  const rows = await database.db.insert(xp_experiments).values([
    { name: 'Running', slug: 'running', kind: 'code', exposurePolicy: 'manual', layer: layerId, status: 'running', layerSlices: [0, 1, 2] },
    { name: 'Decided', slug: 'decided', kind: 'code', exposurePolicy: 'manual', layer: layerId, status: 'decided', layerSlices: [2, 3, 4] },
    { name: 'Stopped', slug: 'stopped', kind: 'code', exposurePolicy: 'manual', layer: layerId, status: 'stopped', layerSlices: [5, 6] },
    { name: 'Draft', slug: 'draft', kind: 'code', exposurePolicy: 'manual', layer: layerId, status: 'draft', layerSlices: [7] },
    { name: 'Archived', slug: 'archived', kind: 'code', exposurePolicy: 'manual', layer: layerId, status: 'archived', layerSlices: [8] },
    { name: 'Other', slug: 'other', kind: 'code', exposurePolicy: 'manual', layer: layers[1]!.id, status: 'running', layerSlices: [9] },
    { name: 'Null', slug: 'null', kind: 'code', exposurePolicy: 'manual', layer: layerId, status: 'decided', layerSlices: null },
  ]).returning()
  ownId = rows[0]!.id
}, 60_000)
afterAll(async () => { await database?.close() })

async function claim(count: number, random?: () => number) {
  return database.db.transaction(async tx => {
    // Only slice SQL is exercised here. Real concurrent layer locks are train-only.
    const req = { transactionID: 'tx', payload: { db: { sessions: { tx: { db: tx } } } } } as unknown as PayloadRequest
    return claimSlices(txExecutor(req), { layerId, experimentId: ownId, count, random })
  })
}

test('claims exact count from the union of running and decided slices, including its own', async () => {
  const all = await claim(95, () => 0)
  expect(all).toEqual(Array.from({ length: 95 }, (_, i) => i + 5))
  const subset = await claim(20)
  expect(subset).toHaveLength(20)
  expect(new Set(subset).size).toBe(20)
  expect(subset).toEqual([...subset].sort((a, b) => a - b))
  expect(subset.every(slice => slice >= 5 && slice < 100)).toBe(true)
  // Claims only return candidates; the caller is responsible for storing them.
  const unchanged = await database.db.select().from(xp_experiments)
  expect(unchanged[0]!.layerSlices).toEqual([0, 1, 2])
})

test('injected random produces deterministic sampling without replacement', async () => {
  expect(await claim(4, () => 0)).toEqual([5, 6, 7, 8])
  expect(await claim(4, () => 0.99999)).toEqual([5, 6, 7, 99])
  expect(await claim(0, () => { throw new Error('No draws needed') })).toEqual([])
})

test('refuses with layer-full 409 when fewer than count are free', async () => {
  await expect(claim(96)).rejects.toMatchObject({ code: 'layer-full', status: 409, detail: { available: 95, requested: 96 } })
})

test('rejects invalid count and random inputs', async () => {
  await expect(claim(-1)).rejects.toBeInstanceOf(RangeError)
  await expect(claim(1.5)).rejects.toBeInstanceOf(RangeError)
  await expect(claim(1, () => 1)).rejects.toBeInstanceOf(RangeError)
  await expect(claim(1, () => NaN)).rejects.toBeInstanceOf(RangeError)
})
