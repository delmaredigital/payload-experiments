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
  const occupancy: Array<{ id: number; arms: Arm[] }> = []
  executor.query = async <R>(text: string, params: unknown[] = []) => {
    executor.calls.push({ text, params })
    let rows: unknown[] = []
    if (text.includes('JOIN LATERAL')) rows = occupancy
    if (text.includes(' AS slices ')) rows = payload.documents['xp-experiments']!.filter(doc => doc.layer === params[0] && ['running', 'decided'].includes(String(doc.status))).map(doc => ({ slices: doc.layerSlices }))
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
  // Model separate stored JSON values even though the fixture reused arms above.
  experiment.arms = structuredClone(experiment.arms)
  const phase = payload.documents['xp-phases']![0]!
  return { req, payload, executor, experiment, phase, manifests, slices, occupancy }
}
import { decide } from '../../src/transitions/decide.js'
import { assign } from '../../src/runtime/assign.js'
import { compileManifest, loadManifestInputs } from '../../src/manifest/compile.js'

test.each(['running', 'stopped'])('rollout copies the test phase tuning instead of the %s document tuning', async status => {
  const f = fixture(status)
  ;(f.phase.analysis as Record<string, unknown>).sequentialTuningParameter = 1234
  f.experiment.analysis = { sequentialTuningParameter: 9876 }
  await decide(f.req, { experimentId: 1, winnerArm: 'variantA' })
  expect(f.payload.documents['xp-phases']![1]).toMatchObject({ phaseKind: 'rollout', analysis: { sequentialTuningParameter: 1234 } })
  expect(f.phase.analysis).toMatchObject({ sequentialTuningParameter: 1234 })
  expect(f.experiment.analysis).toEqual({ sequentialTuningParameter: 9876 })
})

test('rollout freezes 5000 for an old test phase without frozen tuning', async () => {
  const f = fixture()
  f.experiment.analysis = { sequentialTuningParameter: 9876 }
  await decide(f.req, { experimentId: 1, winnerArm: 'variantA' })
  expect(f.payload.documents['xp-phases']![1]).toMatchObject({ phaseKind: 'rollout', analysis: { sequentialTuningParameter: 5000 } })
  expect(f.phase.analysis).not.toHaveProperty('sequentialTuningParameter')
})

test.each([false, true])('decide preserves holdout membership at 50% allocation (layer=%s)', async layer => {
  const f = fixture('running', true, layer)
  const before = compileManifest(await loadManifestInputs(f.req), 8)
  const result = await decide(f.req, { experimentId: 1, winnerArm: 'variantA' })
  expect(result).toMatchObject({ doc: { status: 'decided', phase: 2, seed: 'test|', decision: { winnerArm: 'variantA', snapshotId: '7', verdictCode: 'winner', decidedBy: '42' } }, revision: 9 })
  expect(f.payload.documents['xp-phases']![1]).toMatchObject({ phaseKind: 'rollout', seed: 'test|', allocation: 50,
    arms: [{ key: 'variantA', weight: 98 }, { key: 'holdout', weight: 2 }], targeting: f.phase.targeting })
  expect(f.phase.endedAt).toBe(result.doc.decidedAt)
  const after = f.manifests[0]
  expect(after.experiments[0].arms.map((a: Arm) => a.weight)).toEqual([5, 93, 2])
  expect(after.experiments[0].targeting).toEqual(f.phase.targeting)
  let held = 0
  for (let i = 0; i < 10000; i++) {
    const unit = { visitorId: String(i), consent: true }
    const a = assign(before, unit, { country: 'US' }, { now: Date.now() }).bySlug.hero!
    const b = assign(after, unit, { country: 'US' }, { now: Date.now() }).bySlug.hero!
    expect(b.arm === 'holdout').toBe(a.arm === 'holdout')
    if (b.arm === 'holdout') held++
  }
  expect(held).toBeGreaterThan(20)
  expect(f.experiment.layerSlices).toEqual(layer ? f.slices : [])
})
test.each([false, true])('no rollout without holdout or when Original wins (holdout=%s)', async holdout => {
  const f = fixture('running', holdout, true)
  const winnerArm = holdout ? 'control' : 'variantA'
  await decide(f.req, { experimentId: 1, winnerArm, note: 'Ship', confirmation: holdout ? 'Original' : 'Better title' })
  expect(f.payload.documents['xp-phases']).toHaveLength(1)
  expect(f.experiment.layerSlices).toEqual([])
  expect(f.manifests[0].experiments[0]).toMatchObject({ coverage: 1, winnerArm })
})
test('decide from stopped preserves endedAt and reclaims the exact original slices', async () => {
  const f = fixture('stopped', true, true)
  await decide(f.req, { experimentId: 1, winnerArm: 'variantA' })
  expect(f.phase.endedAt).toBe('2026-10-20T00:00:00.000Z')
  expect(f.experiment.layerSlices).toEqual(f.slices)
})
test('stopped decision refuses when any original slice was taken', async () => {
  const f = fixture('stopped', true, true)
  f.payload.documents['xp-experiments']!.push({ id: 2, status: 'running', layer: 3, layerSlices: [12] })
  await expect(decide(f.req, { experimentId: 1, winnerArm: 'variantA' })).rejects.toMatchObject({ code: 'slices-taken' })
  expect(f.payload.documents['xp-phases']).toHaveLength(1)
})
test.each(['draft', 'decided', 'archived'])('refuses %s', async status => {
  const f = fixture(status)
  await expect(decide(f.req, { experimentId: 1, winnerArm: 'variantA' })).rejects.toMatchObject({ code: 'invalid-status' })
})
test.each(['holdout', 'missing', ''])('refuses invalid winner %j', async winnerArm => {
  const f = fixture()
  await expect(decide(f.req, { experimentId: 1, winnerArm })).rejects.toMatchObject({ code: 'invalid-winner' })
})
test.each([
  ['  Better title  ', ' Better title ', true], ['Better title', 'better title', false], ['Better title', 'variantA', false],
  ['', 'Variant A', true], ['   ', 'variantA', false], ['', 'Variant A ', true],
])('confirmation uses stored label %j, typed %j', async (label, confirmation, ok) => {
  const f = fixture()
  ;(f.phase.arms as Arm[])[1]!.label = label as string
  f.payload.documents['xp-results-snapshots'] = []
  const action = decide(f.req, { experimentId: 1, winnerArm: 'variantA', confirmation: confirmation as string, note: 'Reason' })
  if (ok) await expect(action).resolves.toMatchObject({ doc: { status: 'decided' } })
  else await expect(action).rejects.toMatchObject({ code: 'confirmation-required' })
})
test.each([1, 2, 3, 4])('guarded verdict row %i requires confirmation and a nonblank note', async row => {
  const f = fixture()
  ;(f.payload.documents['xp-results-snapshots']![0]!.snapshot as any).verdict.row = row
  await expect(decide(f.req, { experimentId: 1, winnerArm: 'variantA', confirmation: 'Better title', note: ' ' })).rejects.toMatchObject({ code: 'confirmation-required' })
})
test('locks layer then flag point then experiment and rechecks state under lock', async () => {
  const f = fixture('running', true, true)
  f.experiment.kind = 'flag'; f.experiment.flagPoint = 'cta'
  await decide(f.req, { experimentId: 1, winnerArm: 'variantA' })
  expect(f.executor.calls.filter(c => c.text.includes('advisory')).map(c => c.params)).toEqual([['3'], ['cta'], ['1'], []])
  const g = fixture()
  const query = g.executor.query
  g.executor.query = async (text, params) => { g.experiment.status = 'archived'; return query(text, params) }
  await expect(decide(g.req, { experimentId: 1, winnerArm: 'variantA' })).rejects.toMatchObject({ code: 'invalid-status' })
})

test.each(['running', 'decided'])('stopped flag decision refuses a point occupied by another %s experiment', async status => {
  const f = fixture('stopped')
  f.experiment.kind = 'flag'; f.experiment.flagPoint = 'cta'
  f.payload.documents['xp-experiments']!.push({ id: 2, kind: 'flag', flagPoint: 'cta', status })
  await expect(decide(f.req, { experimentId: 1, winnerArm: 'variantA' })).rejects.toMatchObject({ code: 'flag-point-busy' })
  expect(f.payload.documents['xp-phases']).toHaveLength(1)
})

test.each(['running', 'decided'])('stopped page decision refuses pages now used by another %s page test', async status => {
  const f = fixture('stopped')
  f.experiment.kind = 'page'
  f.occupancy.push({ id: 2, arms: [
    { key: 'control', label: 'Original', kind: 'control', weight: 50, pageTarget: '/original/' }, { key: 'variantA', label: 'Variant A', kind: 'variant', weight: 50, pageTarget: '/elsewhere' },
  ] })
  await expect(decide(f.req, { experimentId: 1, winnerArm: 'variantA' })).rejects.toMatchObject({ code: 'page-in-use', detail: { paths: ['/original'] } })
  expect(f.executor.calls.some(call => call.text.includes("hashtext('xp:pagepath')"))).toBe(true)
  expect(f.payload.documents['xp-phases']).toHaveLength(1)
})
test('stopped page decision checks the frozen round arms, not the edited document', async () => {
  const f = fixture('stopped')
  f.experiment.kind = 'page'
  // The stopped document was edited away from /original; the frozen round still restores it.
  f.experiment.arms = (f.experiment.arms as Arm[]).map(arm => arm.kind === 'control' ? { ...arm, pageTarget: '/edited' } : arm)
  f.occupancy.push({ id: 2, arms: [{ key: 'control', label: 'Original', kind: 'control', weight: 100, pageTarget: '/original' }] })
  await expect(decide(f.req, { experimentId: 1, winnerArm: 'variantA' })).rejects.toMatchObject({ code: 'page-in-use', detail: { paths: ['/original'] } })
})
test('stopped page decision proceeds when no other live page test shares its pages', async () => {
  const f = fixture('stopped')
  f.experiment.kind = 'page'
  f.payload.documents['xp-experiments']!.push({ id: 2, kind: 'page', status: 'draft', arms: [{ key: 'control', kind: 'control', weight: 100, pageTarget: '/original' }] })
  // A draft page test on the same pages does not occupy them.
  await expect(decide(f.req, { experimentId: 1, winnerArm: 'variantA' })).resolves.toBeDefined()
})
test('stopped decision uses the frozen winner and label after the document arm was removed', async () => {
  const f = fixture('stopped')
  f.experiment.arms = [(f.experiment.arms as Arm[])[0]]
  f.payload.documents['xp-results-snapshots'] = []
  const result = await decide(f.req, { experimentId: 1, winnerArm: 'variantA', note: 'Ship the tested group', confirmation: 'Better title' })
  expect(result.doc).toMatchObject({ status: 'decided', decision: { winnerArm: 'variantA' } })
  expect(f.payload.documents['xp-phases']![1]).toMatchObject({ arms: [{ key: 'variantA', label: '  Better title  ' }, { key: 'holdout' }] })
})
test('a renamed document label cannot substitute for the frozen test-phase label', async () => {
  const f = fixture('stopped')
  ;(f.experiment.arms as Arm[])[1]!.label = 'Unrelated edit'
  f.payload.documents['xp-results-snapshots'] = []
  await expect(decide(f.req, { experimentId: 1, winnerArm: 'variantA', note: 'Ship', confirmation: 'Unrelated edit' })).rejects.toMatchObject({ code: 'confirmation-required' })
})
test('an arm added only to the stopped document is not a test-phase winner', async () => {
  const f = fixture('stopped')
  ;(f.experiment.arms as Arm[]).push({ key: 'variantB', label: 'New group', kind: 'variant', weight: 0 })
  await expect(decide(f.req, { experimentId: 1, winnerArm: 'variantB', note: 'Ship', confirmation: 'New group' })).rejects.toMatchObject({ code: 'invalid-winner' })
})

function stoppedPageFixture() {
  const f = fixture('stopped', false)
  f.experiment.kind = 'page'; f.experiment.pageCollection = 'pages'
  const options = f.payload.config.custom!.xp as ReturnType<typeof sampleOptions>
  const findByPath = vi.fn(async (path: string) => ({ id: path, published: path === '/original' }))
  options.pages = { collections: [{ slug: 'pages', pathOf: () => null, findByPath }] }
  return { ...f, options, findByPath }
}

// Measured below 100 ms locally; each cap leaves CI headroom.
test('Original wins from stopped when the losing variant page is unpublished', async () => {
  const f = stoppedPageFixture()
  await expect(decide(f.req, { experimentId: 1, winnerArm: 'control', confirmation: 'Original', note: 'Keep Original' })).resolves.toMatchObject({ doc: { status: 'decided' } })
  expect(f.findByPath.mock.calls.map(([path]) => path)).toEqual(['/original'])
}, 5000)

test('stopped decision refuses an unpublished winner page', async () => {
  const f = stoppedPageFixture()
  await expect(decide(f.req, { experimentId: 1, winnerArm: 'variantA' })).rejects.toMatchObject({ code: 'page-target-unpublished', detail: '/winner' })
}, 5000)

test.each([true, false])('throwing page lookup propagates to Payload as a server error (stored collection=%s)', async stored => {
  const f = stoppedPageFixture(), failure = new Error('host lookup failed')
  if (!stored) {
    delete f.experiment.pageCollection
    f.options.pages!.collections.push({ slug: 'other', pathOf: () => null, findByPath: async () => null })
  }
  f.findByPath.mockRejectedValue(failure)
  Object.assign(f.payload.db, { defaultIDType: 'number' })
  f.req.routeParams = { id: '1' }; f.req.data = { winnerArm: 'variantA' }
  const { handleDecide } = await import('../../src/endpoints/transitions.js')
  // Payload owns the generic 500 response; the endpoint must propagate the original error.
  await expect(handleDecide(f.req, { options: f.options })).rejects.toBe(failure)
  expect(failure).not.toHaveProperty('code', 'page-target-unpublished')
}, 5000)

test('decide from stopped refreshes block placement docs from its detached rescan', async () => {
  const f = fixture('stopped', false), options = f.payload.config.custom!.xp as ReturnType<typeof sampleOptions>
  f.experiment.kind = 'block'
  options.blocks = { collections: [{ slug: 'pages', field: 'layout' }] }
  f.payload.documents.pages = [{ id: 10, _status: 'published', layout: [{ blockType: 'xpExperiment', experiment: 'hero', slots: [
    { slot: 'control', blocks: [{ blockType: 'text' }] }, { slot: 'variantA', blocks: [{ blockType: 'text' }] },
  ] }] }]
  const find = vi.mocked(f.payload.find).getMockImplementation()!
  vi.mocked(f.payload.find).mockImplementation(async args => {
    if (args.collection === 'pages') expect(await f.req.transactionID).toBeUndefined()
    return find(args)
  })
  await decide(f.req, { experimentId: 1, winnerArm: 'variantA' })
  expect(f.executor.calls.filter(call => call.text.includes('"placement_docs" = $1::jsonb'))).toEqual([
    expect.objectContaining({ params: [JSON.stringify([{ collection: 'pages', id: 10 }]), 1, 1] }),
  ])
}, 5000)
