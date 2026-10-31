import { expect, test, vi } from 'vitest'
import { fakePayload } from '../_fakes/payload.js'
import { fakeReq } from '../_fakes/req.js'
import { createFakeExecutor } from '../_fakes/executor.js'
import { sampleOptions } from '../collections/fixtures.js'
import { defaultArms } from '../../src/collections/experiments/armInvariants.js'
import { compileManifest, loadManifestInputs } from '../../src/manifest/compile.js'

function fixture(status = 'draft', layer = false) {
  const options = sampleOptions()
  const executor = createFakeExecutor()
  const payload = fakePayload({ executor, config: { custom: { xp: options } },
    overrides: { findGlobal: vi.fn(async () => ({ flagDefaults: {} })) },
    collections: {
      'xp-experiments': [{ id: 1, slug: 'hero', kind: 'code', status, unitType: 'visitor', arms: defaultArms('code'),
        allocation: 20, phase: status === 'draft' ? 0 : 1, seed: 'old|', updatedAt: 'v1', layerSlices: layer && status === 'running' ? [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19] : [],
        ...(layer ? { layer: 3 } : {}), exposurePolicy: 'manual', metrics: { primary: 2 },
        targeting: [{ attribute: 'country', op: 'eq', value: 'US' }], analysis: { plannedDurationDays: 14, reachPerDay: 100, cuped: 'auto' } }],
      'xp-metrics': [{ id: 2, source: 'binomial', name: 'Signups', direction: 'increase', attributionWindowHours: 168 }, { id: 4, source: 'revenue', name: 'Gifts', attributionWindowHours: 24 }],
      'xp-layers': [{ id: 3, slug: 'home', unitType: 'visitor' }],
      'xp-phases': status === 'draft' ? [] : [{ id: 9, experiment: 1, phase: 1, phaseKind: 'test', seed: 'old|', arms: defaultArms('code'), allocation: 20, targeting: [], metricDefinitions: [{ id: 2, metricId: 2, role: 'primary' }] }],
    },
  })
  let revision = 8
  const manifests: unknown[] = []
  executor.query = async <R>(text: string, params: unknown[] = []) => {
    executor.calls.push({ text, params })
    let rows: unknown[] = []
    let rowCount = 1
    if (text.includes(' AS slices ')) rows = payload.documents['xp-experiments']!.filter(doc => doc.layer === params[0] && ['running', 'decided'].includes(String(doc.status))).map(doc => ({ slices: doc.layerSlices }))
    if (text.includes('txid_current()')) rows = [{ xid: '10' }]
    if (text.includes('txid_status(')) rows = [{ status: 'committed' }]
    if (text.includes('RETURNING "revision"')) rows = [{ revision: ++revision }]
    if (text.startsWith('SELECT "revision"')) rows = [{ revision, manifest: null, flagDefaults: {} }]
    if (text.includes('"manifest" =')) manifests.push(JSON.parse(params[0] as string))
    if (text.includes('coalesce("allocation_changes"')) {
      const phase = payload.documents['xp-phases']!.find(doc => doc.experiment === params[1] && doc.phase === params[2])
      if (!phase) rowCount = 0
      else phase.allocationChanges = [...(phase.allocationChanges as unknown[] ?? []), ...JSON.parse(params[0] as string)]
    }
    return { rows: rows as R[], rowCount }
  }
  const find = payload.find.bind(payload)
  vi.spyOn(payload, 'find').mockImplementation(async args => {
    const result = await find(args)
    if (args.depth === 1 && args.collection === 'xp-experiments') for (const doc of result.docs) if (doc.layer === 3) doc.layer = { id: 3, slug: 'home' }
    return result
  })
  const req = executor.withSession({ payload })
  const experiment = payload.documents['xp-experiments']![0]!
  return { options, payload, executor, req, experiment, manifests }
}
import { allocate } from '../../src/transitions/allocate.js'
import { assign } from '../../src/runtime/assign.js'
import type { Manifest } from '../../src/types/manifest.js'

test('raising coverage preserves every enrolled arm and appends audit history', async () => {
  const { req, payload, experiment, manifests } = fixture('running')
  const before = compileManifest(await loadManifestInputs(req), 8)
  const result = await allocate(req, { experimentId: 1, allocation: 70 })
  expect(result).toMatchObject({ doc: { allocation: 70, seed: 'old|', phase: 1 }, revision: 9 })
  const after = manifests[0] as Manifest
  expect(after.experiments[0]!.coverage).toBe(0.7)
  let enrolled = 0, added = 0
  for (let i = 0; i < 10000; i++) {
    const unit = { visitorId: String(i), consent: true }
    const a = assign(before, unit, {}, { now: 0 }).bySlug.hero!
    const b = assign(after, unit, {}, { now: 0 }).bySlug.hero!
    if (a.exposable) { enrolled++; expect(b).toMatchObject({ arm: a.arm, exposable: true }) }
    else if (b.exposable) added++
  }
  expect(enrolled).toBeGreaterThan(1500)
  expect(added).toBeGreaterThan(4000)
  expect(payload.documents['xp-phases']![0]!.allocationChanges).toEqual([{ at: expect.any(String), from: 20, to: 70 }])
  expect(experiment.seed).toBe('old|')
})
test('layer allocation retains old slices, claims only free extras and leaves coverage at 1', async () => {
  const { req, experiment, manifests, payload, executor } = fixture('running', true)
  const old = [...experiment.layerSlices as number[]]
  payload.documents['xp-experiments']!.push({ id: 8, layer: 3, status: 'running', layerSlices: [98, 99] })
  // Keep the unrelated peer out of manifest inputs (its assignment is not under test).
  const find = vi.mocked(payload.find).getMockImplementation()!
  vi.mocked(payload.find).mockImplementation(async args => {
    const result = await find(args)
    if (args.depth === 1) result.docs = result.docs.filter(doc => doc.id === 1)
    return result
  })
  await allocate(req, { experimentId: 1, allocation: 50 })
  const slices = experiment.layerSlices as number[]
  expect(slices).toHaveLength(50)
  expect(slices).toEqual(expect.arrayContaining(old))
  expect(slices).not.toContain(98); expect(slices).not.toContain(99)
  expect(manifests[0]).toMatchObject({ experiments: [{ coverage: 1, layer: { slices } }] })
  expect(executor.calls.filter(call => call.text.includes('advisory')).map(call => call.params)).toEqual([['3'], ['1'], []])
})
test.each(['draft', 'stopped', 'decided', 'archived'])('refuses %s', async status => {
  const { req } = fixture(status)
  await expect(allocate(req, { experimentId: 1, allocation: 40 })).rejects.toMatchObject({ code: 'invalid-status', status: 409 })
})
test.each([10, 20])('refuses lower or equal allocation %s', async allocation => {
  const { req } = fixture('running')
  await expect(allocate(req, { experimentId: 1, allocation })).rejects.toMatchObject({ code: 'allocation-lower' })
})
test.each([0, 101, 20.5, NaN])('refuses invalid allocation %s', async allocation => {
  const { req } = fixture('running')
  await expect(allocate(req, { experimentId: 1, allocation })).rejects.toMatchObject({ code: 'invalid-body' })
})
test('refuses a full layer without changing allocation or audit history', async () => {
  const { req, experiment, payload } = fixture('running', true)
  payload.documents['xp-experiments']!.push({ id: 8, layer: 3, status: 'decided', layerSlices: Array.from({ length: 70 }, (_, i) => i + 20) })
  await expect(allocate(req, { experimentId: 1, allocation: 50 })).rejects.toMatchObject({ code: 'layer-full' })
  expect(experiment.allocation).toBe(20)
  expect(payload.documents['xp-phases']![0]).not.toHaveProperty('allocationChanges')
})
test('rechecks current status under the lock, unknown experiment is 404', async () => {
  const { req, executor, experiment } = fixture('running')
  const query = executor.query
  executor.query = async (text, params) => { experiment.status = 'stopped'; return query(text, params) }
  await expect(allocate(req, { experimentId: 1, allocation: 50 })).rejects.toMatchObject({ code: 'invalid-status' })
  await expect(allocate(req, { experimentId: 99, allocation: 50 })).rejects.toMatchObject({ code: 'not-found', status: 404 })
})
