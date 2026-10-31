import { expect, test, vi } from 'vitest'
import { fakePayload } from '../_fakes/payload.js'
import { createFakeExecutor } from '../_fakes/executor.js'
import { sampleOptions } from '../collections/fixtures.js'
import type { Arm } from '../../src/types/contracts.js'

function fixture(status = 'running', holdout = true, layer = false) {
  const options = sampleOptions()
  const executor = createFakeExecutor()
  const arms: Arm[] = [
    { key: 'control', label: 'Original', kind: 'control', weight: holdout ? 5 : 50, slot: 'control', pageTarget: '/original' },
    { key: 'variantA', label: '  Better title  ', kind: 'variant', weight: holdout ? 93 : 50, slot: 'variantA', pageTarget: '/winner' },
    ...(holdout ? [{ key: 'holdout', label: 'Holdout', kind: 'holdout', weight: 2 } as Arm] : []),
  ]
  const slices = Array.from({ length: 50 }, (_, i) => i)
  const payload = fakePayload({ executor, config: { custom: { xp: options } },
    overrides: { findGlobal: vi.fn(async () => ({ flagDefaults: {} })) },
    collections: {
      'xp-experiments': [{ id: 1, slug: 'hero', kind: 'code', status, unitType: 'visitor', arms, allocation: 50,
        phase: 1, seed: 'test|', layerSlices: layer && status === 'running' ? slices : [], ...(layer ? { layer: 3 } : {}),
        targeting: [{ attribute: 'country', op: 'eq', value: 'CHANGED' }], exposurePolicy: 'manual' }],
      'xp-phases': [{ id: 9, experiment: 1, phase: 1, phaseKind: 'test', seed: 'test|', arms, allocation: 50,
        startedAt: '2026-10-01T00:00:00.000Z', ...(status === 'stopped' ? { endedAt: '2026-10-20T00:00:00.000Z' } : {}),
        targeting: [{ attribute: 'country', op: 'eq', value: 'US', type: 'string' }],
        metricDefinitions: [{ metricId: 2, role: 'primary' }], analysis: { layerSlices: layer ? slices : [] } }],
      'xp-results-snapshots': [{ id: 7, experiment: 1, phase: 1, computedAt: '2026-10-21T00:00:00.000Z', snapshot: { verdict: { row: 7, code: 'winner', recommendedArm: 'variantA' } } }],
    },
  })
  let revision = 8
  const manifests: any[] = []
  executor.query = async <R>(text: string, params: unknown[] = []) => {
    executor.calls.push({ text, params })
    let rows: unknown[] = []
    if (text.includes(' AS slices ')) rows = payload.documents['xp-experiments']!.filter(doc => doc.layer === params[0] && ['running', 'decided'].includes(String(doc.status))).map(doc => ({ slices: doc.layerSlices }))
    if (text.startsWith('DELETE FROM') && text.includes('xp_results_snapshots')) payload.documents['xp-results-snapshots'] = payload.documents['xp-results-snapshots']!.filter(doc => doc.experiment !== params[0])
    if (text.includes('RETURNING "revision"')) rows = [{ revision: ++revision }]
    if (text.includes('"manifest" =')) manifests.push(JSON.parse(params[0] as string))
    return { rows: rows as R[], rowCount: 1 }
  }
  const find = payload.find.bind(payload)
  vi.spyOn(payload, 'find').mockImplementation(async args => {
    // The fake does not sort. Model Payload's newest-round/snapshot query here.
    const result = await find({ ...args, limit: 0 })
    if (args.sort) result.docs.sort((a, b) => args.collection === 'xp-phases' ? Number(b.phase) - Number(a.phase) : String(b.computedAt).localeCompare(String(a.computedAt)))
    if (args.limit) result.docs = result.docs.slice(0, args.limit)
    if (args.depth === 1) for (const doc of result.docs) if (doc.layer === 3) doc.layer = { id: 3, slug: 'home' }
    return result
  })
  const req = executor.withSession({ payload })
  req.user = { id: 42 } as typeof req.user
  const experiment = payload.documents['xp-experiments']![0]!
  const phase = payload.documents['xp-phases']![0]!
  return { req, payload, executor, experiment, phase, manifests, slices }
}
import { deleteExperiment, deleteExperimentAfter } from '../../src/transitions/deleteExperiment.js'
import { buildAndStoreManifest } from '../../src/manifest/compile.js'

test.each(['draft', 'archived'])('delete %s cascades by id in the same request before the row is removed', async status => {
  const f = fixture(status)
  await deleteExperiment(f.req, 1)
  expect(f.payload.documents['xp-experiments']).toHaveLength(1)
  expect(f.payload.documents['xp-phases']).toEqual([])
  expect(f.payload.documents['xp-results-snapshots']).toEqual([])
  expect(f.executor.calls.some(c => c.text.startsWith('DELETE FROM') && c.params[0] === 1)).toBe(true)
  expect(f.executor.calls.filter(c => c.text.includes('advisory')).map(c => c.params)).toEqual([['1']])
  const calls = f.payload.calls.filter(c => c.method === 'delete')
  expect(calls).toHaveLength(1)
  for (const call of calls) expect(call.args).toMatchObject({ req: f.req, overrideAccess: true, id: expect.any(Number) })
  f.payload.documents['xp-experiments'] = []
  await deleteExperimentAfter(f.req, 1)
  expect(f.manifests[0]).toMatchObject({ revision: 9, experiments: [], archivedWinners: {} })
})
test.each(['running', 'stopped', 'decided'])('delete refuses %s before cascading', async status => {
  const f = fixture(status)
  await expect(deleteExperiment(f.req, 1)).rejects.toMatchObject({ code: 'invalid-status' })
  expect(f.payload.calls.some(c => c.method === 'delete')).toBe(false)
})
test('cascade errors are logged and thrown, never swallowed', async () => {
  const f = fixture('archived')
  vi.spyOn(f.payload, 'delete').mockRejectedValue(new Error('cascade failed'))
  await expect(deleteExperiment(f.req, 1)).rejects.toThrow('cascade failed')
  expect(f.payload.logs).toContainEqual({ level: 'error', args: [expect.objectContaining({ experimentId: 1 }), expect.any(String)] })
  expect(f.manifests).toEqual([])
})
test('afterDelete excludes stale experiment/default routing reads', async () => {
  const f = fixture('archived')
  f.experiment.kind = 'block'; f.experiment.decision = { winnerArm: null, discardedAt: '2026-10-22T00:00:00.000Z' }
  f.payload.findGlobal.mockResolvedValue({ flagDefaults: { cta: { experiment: 1, winnerArm: 'variantA', params: {}, decidedAt: 'now' } } } as any)
  f.payload.updateGlobal = vi.fn(async args => {
    f.payload.findGlobal.mockResolvedValue({ flagDefaults: (args.data as any).flagDefaults })
    return {} as any
  }) as typeof f.payload.updateGlobal
  await deleteExperiment(f.req, 1)
  await deleteExperimentAfter(f.req, 1)
  expect(f.manifests[0]).toMatchObject({ archivedWinners: {}, archivedPages: {}, flagDefaults: {}, experiments: [] })
  f.payload.documents['xp-experiments'] = []
  await buildAndStoreManifest(f.req)
  expect(f.manifests[1].flagDefaults).toEqual({})
})

test.each(['draft', 'discard', 'stopped', 'after-content', 'hard-coded'] as const)('three concurrent deletes share a transaction (%s)', async mode => {
  const f = fixture(mode === 'draft' ? 'draft' : 'archived')
  const sourceExperiment = structuredClone(f.experiment)
  const sourcePhase = structuredClone(f.phase)
  const ids = [1, 2, 3]
  f.payload.documents['xp-experiments'] = ids.map(id => ({ ...structuredClone(sourceExperiment), id, slug: `flag-${id}`, kind: 'flag',
    decision: { winnerArm: mode === 'discard' ? null : 'variantA', ...(mode === 'discard' ? { discardedAt: 'now' } : {}) } }))
  f.payload.documents['xp-phases'] = ids.map(id => ({ ...structuredClone(sourcePhase), id: 10 + id, experiment: id }))
  f.payload.documents['xp-results-snapshots'] = ids.map(id => ({ id: 20 + id, experiment: id, snapshot: { large: 'not loaded' } }))
  let defaults = Object.fromEntries([...ids, 99].map(id => [`point-${id}`, { experiment: id, winnerArm: 'variantA', params: { title: `Shipped ${id}` }, decidedAt: 'now' }]))
  let activeReads = 0, maxActiveReads = 0
  f.payload.findGlobal.mockImplementation(async () => {
    const flagDefaults = structuredClone(defaults)
    maxActiveReads = Math.max(maxActiveReads, ++activeReads)
    await Promise.resolve()
    await Promise.resolve()
    activeReads--
    return { flagDefaults } as any
  })
  f.payload.updateGlobal = vi.fn(async args => {
    await Promise.resolve()
    defaults = structuredClone((args.data as any).flagDefaults)
    return { flagDefaults: defaults } as any
  }) as typeof f.payload.updateGlobal
  // Payload bulk delete maps documents to concurrent before -> row -> after work.
  // Different request wrappers sharing a transaction must still share the queue.
  await Promise.all(ids.map(async id => {
    const req = { ...f.req }
    await deleteExperiment(req, id)
    await f.payload.delete({ collection: 'xp-experiments', id, req, overrideAccess: false })
    await deleteExperimentAfter(req, id)
  }))
  const expected = mode === 'draft' || mode === 'discard' ? ['point-99'] : ['point-1', 'point-2', 'point-3', 'point-99']
  expect(Object.keys(defaults).sort()).toEqual(expected)
  expect(maxActiveReads).toBe(1)
  expect(f.manifests).toHaveLength(3)
  expect(f.manifests.at(-1)).toMatchObject({ experiments: [], archivedWinners: {}, archivedPages: {}, flagDefaults: defaults })
  expect(f.payload.calls.filter(call => call.args.collection === 'xp-results-snapshots')).toEqual([])
  await buildAndStoreManifest(f.req)
  expect(f.manifests.at(-1).flagDefaults).toEqual(defaults)
})
