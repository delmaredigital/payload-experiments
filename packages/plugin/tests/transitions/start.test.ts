import { expect, test, vi } from 'vitest'
import { fakePayload } from '../_fakes/payload.js'
import { pageArms, pageOccupancyDb } from '../_helpers/pageOccupancy.js'
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
  const occupancy: Array<{ id: number; arms: import('../../src/types/contracts.js').Arm[] }> = []
  executor.query = async <R>(text: string, params: unknown[] = []) => {
    executor.calls.push({ text, params })
    let rows: unknown[] = []
    let rowCount = 1
    if (text.includes('JOIN LATERAL')) rows = occupancy
    if (text.includes(' AS slices ')) rows = payload.documents['xp-experiments']!.filter(doc => doc.layer === params[0] && ['running', 'decided'].includes(String(doc.status))).map(doc => ({ slices: doc.layerSlices }))
    if (text.includes('FOR SHARE')) rows = payload.documents['xp-metrics']!.filter(doc => (params[0] as unknown[]).includes(doc.id)).map(doc => ({ id: doc.id, slug: doc.slug, source: doc.source }))
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
  return { options, payload, executor, req, experiment, manifests, occupancy }
}
import { start } from '../../src/transitions/start.js'
import { stop } from '../../src/transitions/stop.js'

test.each([undefined, null])('blank tuning %s is frozen as 5000 without changing the experiment', async tuning => {
  const { req, options, payload, experiment } = fixture()
  const analysis = experiment.analysis as Record<string, unknown>
  if (tuning === null) analysis.sequentialTuningParameter = null
  const before = structuredClone(analysis)
  await start(req, { experimentId: 1, options })
  expect(payload.documents['xp-phases']![0]).toMatchObject({ analysis: { sequentialTuningParameter: 5000 } })
  expect(experiment.analysis).toEqual(before)
})

test('explicit tuning is frozen as 1234 without changing the experiment', async () => {
  const { req, options, payload, experiment } = fixture()
  ;(experiment.analysis as Record<string, unknown>).sequentialTuningParameter = 1234
  await start(req, { experimentId: 1, options })
  expect(payload.documents['xp-phases']![0]).toMatchObject({ analysis: { sequentialTuningParameter: 1234 } })
  expect(experiment.analysis).toMatchObject({ sequentialTuningParameter: 1234 })
})

test('restart from stopped freezes the live tuning without changing the previous round', async () => {
  const { req, options, payload, experiment } = fixture()
  await start(req, { experimentId: 1, options })
  await stop(req, { experimentId: 1 })
  ;(experiment.analysis as Record<string, unknown>).sequentialTuningParameter = 1234
  await start(req, { experimentId: 1, options })
  await stop(req, { experimentId: 1 })
  ;(experiment.analysis as Record<string, unknown>).sequentialTuningParameter = null
  await start(req, { experimentId: 1, options })
  expect(payload.documents['xp-phases']!.map(phase => phase.analysis)).toMatchObject([
    { sequentialTuningParameter: 5000 }, { sequentialTuningParameter: 1234 }, { sequentialTuningParameter: 5000 },
  ])
  expect(experiment.analysis).toMatchObject({ sequentialTuningParameter: null })
})

test('starts with frozen metrics and typed targeting; retyping the registry does not change the manifest', async () => {
  const { req, options, payload, manifests, executor } = fixture()
  const result = await start(req, { experimentId: 1, options })
  expect(result).toMatchObject({ doc: { status: 'running', phase: 1 }, revision: 9 })
  const phase = payload.documents['xp-phases']![0]!
  expect(phase).toMatchObject({ phaseKind: 'test', targeting: [{ attribute: 'country', op: 'eq', value: 'US', type: 'string' }],
    metricDefinitions: [{ id: 2, metricId: 2, role: 'primary', kind: 'binomial', resolvedCap: null, addedAt: result.doc.startedAt }], analysis: { alpha: 0.05, cuped: 'auto' } })
  expect(phase.seed).toMatch(/^[a-f0-9]{32}\|$/)
  expect(req.context).not.toHaveProperty('xpTransition')
  const inputs = await loadManifestInputs(req)
  expect(compileManifest(inputs, 9, { attributeKeys: { country: { type: 'number' } } })).toEqual(manifests[0])
  expect(executor.calls.filter(call => call.text.includes('advisory')).map(call => call.params)).toEqual([['1'], []])
  for (const call of payload.calls.filter(call => call.method === 'create' || call.method === 'update')) expect(call.args).toMatchObject({ req, overrideAccess: true })
})
test('two starts from stopped draw different seeds and advance the phase', async () => {
  const { req, options, payload, experiment } = fixture('stopped')
  const first = await start(req, { experimentId: 1, options })
  await stop(req, { experimentId: 1 })
  const second = await start(req, { experimentId: 1, options })
  expect(first.doc.seed).not.toBe(second.doc.seed)
  expect(second.doc.phase).toBe(3)
  expect(experiment.status).toBe('running')
  expect(payload.documents['xp-phases']).toHaveLength(3)
})
test('layer start claims allocation free slices; stop frees them', async () => {
  const { req, options, experiment, executor } = fixture('draft', true)
  await start(req, { experimentId: 1, options })
  expect(experiment.layerSlices).toHaveLength(20)
  expect(new Set(experiment.layerSlices as number[]).size).toBe(20)
  expect(executor.calls.filter(call => call.text.includes('advisory')).map(call => call.params)).toEqual([['3'], ['1'], []])
  await stop(req, { experimentId: 1 })
  expect(experiment.layerSlices).toEqual([])
})
test.each([
  ['invalid-status', { status: 'decided' }], ['weights-total', { arms: [{ ...defaultArms('code')[0], weight: 1 }, defaultArms('code')[1]] }],
  ['control-count', { arms: [{ ...defaultArms('code')[1], weight: 100 }] }], ['control-first', { arms: defaultArms('code').reverse() }],
  ['no-planned-duration', { analysis: { reachPerDay: 100 } }], ['no-primary-metric', { metrics: {} }],
  ['no-reach-per-day', { analysis: { plannedDurationDays: 14 } }], ['page-no-targets', { kind: 'page' }],
  ['page-user-unit', { kind: 'page', unitType: 'user', arms: defaultArms('page').map(arm => ({ ...arm, pageTarget: `/${arm.key}` })) }],
  ['flag-no-point', { kind: 'flag' }], ['no-placements', { kind: 'block', arms: defaultArms('block') }],
  ['undeclared-targeting-key', { targeting: [{ attribute: 'unknown', op: 'eq', value: 'x' }] }],
])('first failing check %s is returned without opening a transaction', async (code, changes) => {
  const { req, options, experiment, executor } = fixture()
  Object.assign(experiment, changes)
  await expect(start(req, { experimentId: 1, options })).rejects.toMatchObject({ code })
  expect(executor.calls.every(call => call.text.includes('JOIN LATERAL'))).toBe(true)
})
test.each([
  { attribute: 'age', op: 'eq', value: 'wrong' }, { attribute: 'age', op: 'contains', value: 1 },
  { attribute: 'country', op: 'in', value: [] },
])('invalid typed rule %j is refused', async rule => {
  const { req, options, experiment } = fixture()
  experiment.targeting = [rule]
  await expect(start(req, { experimentId: 1, options })).rejects.toMatchObject({ code: 'invalid-targeting-rule' })
})
test('unknown experiment is 404', async () => {
  const { req, options } = fixture()
  await expect(start(req, { experimentId: 999, options })).rejects.toMatchObject({ code: 'not-found', status: 404 })
})
test('history runs before locks; a changed updatedAt refuses stale-draft', async () => {
  const { req, options, experiment, executor, payload } = fixture()
  experiment.metrics = { primary: 4 }
  options.metricSources!.find(source => source.kind === 'revenue')!.query = async () => {
    expect(executor.calls).toEqual([])
    expect(req.context).not.toHaveProperty('xpTransition')
    experiment.updatedAt = 'v2'
    return []
  }
  await expect(start(req, { experimentId: 1, options })).rejects.toMatchObject({ code: 'stale-draft', status: 409 })
  expect(payload.documents['xp-phases']).toEqual([])
})
test.each(['status', 'flag', 'layer'] as const)('rechecks %s conflicts after locks', async conflict => {
  const { req, options, experiment, executor, payload } = fixture('draft', conflict === 'layer')
  if (conflict === 'flag') {
    experiment.kind = 'flag'; experiment.flagPoint = 'cta'
    options.flagPoints![0]!.placements = async () => [{ arm: 'control', ok: true }, { arm: 'variantA', ok: true }]
  }
  const query = executor.query
  executor.query = async (text, params) => {
    if (text.includes("hashtext('xp:experiment')")) {
      if (conflict === 'status') experiment.status = 'running'
      else payload.documents['xp-experiments']!.push({ id: 8, status: 'running', flagPoint: 'cta', layer: 3, layerSlices: Array.from({ length: 90 }, (_, i) => i) })
    }
    return query(text, params)
  }
  await expect(start(req, { experimentId: 1, options })).rejects.toMatchObject({ code: conflict === 'status' ? 'invalid-status' : conflict === 'flag' ? 'flag-point-busy' : 'layer-full' })
})
test('phase is built from the in-transaction read and effective flag defaults', async () => {
  const { req, options, experiment, payload, executor } = fixture()
  experiment.kind = 'flag'; experiment.flagPoint = 'cta'
  options.flagPoints![0]!.placements = async () => [{ arm: 'control', ok: true }, { arm: 'variantA', ok: true }]
  const query = executor.query
  executor.query = async (text, params) => {
    if (text.includes("hashtext('xp:experiment')")) {
      experiment.analysis = { plannedDurationDays: 30, reachPerDay: 50 }
      payload.findGlobal.mockResolvedValue({ flagDefaults: { cta: { params: { title: 'Current' } } } })
    }
    return query(text, params)
  }
  await start(req, { experimentId: 1, options })
  expect(payload.documents['xp-phases']![0]).toMatchObject({ analysis: { plannedDurationDays: 30 }, arms: [{ params: { title: 'Current' } }, expect.anything()] })
})
test('missing cap history is a detail note and does not prevent starting', async () => {
  const { req, options, experiment } = fixture()
  experiment.metrics = { primary: 4 }
  options.metricSources!.find(source => source.kind === 'revenue')!.query = async () => { throw new Error('offline') }
  const result = await start(req, { experimentId: 1, options })
  expect(result).toMatchObject({ doc: { status: 'running' }, detail: [{ metricId: 4, message: expect.any(String) }] })
})

test('manager field access does not strip the frozen analysis method or leak hidden fields in the response', async () => {
  const { req, options, experiment, payload } = fixture()
  options.access.admin = () => false
  experiment.analysis = { method: 'bayesian', plannedDurationDays: 14, reachPerDay: 100, cuped: 'auto' }
  const find = vi.mocked(payload.find).getMockImplementation()!
  vi.mocked(payload.find).mockImplementation(async args => {
    const result = await find(args)
    if (args.collection === 'xp-experiments' && args.overrideAccess === false) {
      for (const doc of result.docs) {
        delete doc.kind
        if (doc.analysis) delete (doc.analysis as Record<string, unknown>).method
      }
    }
    return result
  })
  const result = await start(req, { experimentId: 1, options })
  expect(result.doc).not.toHaveProperty('kind')
  expect(result.doc.analysis).not.toHaveProperty('method')
  expect(payload.documents['xp-phases']![0]).toMatchObject({ analysis: {
    method: 'bayesian', alpha: 0.05, cupedLookbackDays: 14, minSampleSizes: { 2: 150 },
    guardrailThresholds: {}, bayesian: { ctw: 0.95, risk: 0.0125 },
  } })
})


import { preflightData, unpublishedPageTargets } from '../../src/transitions/preflightData.js'
function pageFixture() {
  const f = fixture()
  const arms: import('../../src/types/contracts.js').Arm[] = defaultArms('page').map((arm, index) => ({ ...arm, pageTarget: index ? '/variant' : '/original' }))
  f.payload.documents.pages = [{ id: 10, slug: 'original', title: 'Original', _status: 'published' }, { id: 11, slug: 'variant', title: 'Variant', _status: 'draft' }]
  const experiment = Object.assign(f.experiment, { kind: 'page', arms })
  return { ...f, experiment }
}
test('page lookups stop after the first collection reports a published page', async () => {
  const { options, req, experiment } = pageFixture()
  const first = vi.fn(async (path: string) => ({ id: path, published: true }))
  const second = vi.fn(async () => null)
  options.pages = { collections: [
    { slug: 'first', pathOf: () => null, findByPath: first },
    { slug: 'second', pathOf: () => null, findByPath: second },
  ] }
  expect(await unpublishedPageTargets(req, options, experiment)).toEqual([])
  expect(first.mock.calls.map(call => call[0])).toEqual(['/original', '/original', '/variant'])
  expect(second).not.toHaveBeenCalled()
})
test('a throwing page collection is logged and the next collection can report it published', async () => {
  const { options, req, experiment, payload } = pageFixture()
  const first = vi.fn(async () => { throw new Error('secret-value') })
  const second = vi.fn(async (path: string) => ({ id: path, published: true }))
  options.pages = { collections: [
    { slug: 'first', pathOf: () => null, findByPath: first },
    { slug: 'second', pathOf: () => null, findByPath: second },
  ] }
  expect(await unpublishedPageTargets(req, options, experiment)).toEqual([])
  expect(first).toHaveBeenCalledTimes(1)
  expect(second.mock.calls.map(call => call[0])).toEqual(['/original', '/original', '/variant'])
  expect(payload.logs).toHaveLength(1)
  expect(JSON.stringify(payload.logs)).not.toContain('secret-value')
})
test('page arms are looked up concurrently and unpublished targets retain arm order', async () => {
  const { options, req, experiment } = pageFixture()
  const finish = new Map<string, (page: null) => void>()
  const findByPath = vi.fn((path: string) => new Promise<null>(resolve => { finish.set(path, resolve) }))
  options.pages = { collections: [{ slug: 'pages', pathOf: () => null, findByPath }] }
  const pending = unpublishedPageTargets(req, options, experiment)
  await Promise.resolve()
  try {
    expect(findByPath.mock.calls.map(call => call[0])).toEqual(['/original', '/variant'])
  } finally {
    finish.get('/variant')?.(null)
    finish.get('/original')?.(null)
  }
  expect(await pending).toEqual(['/original', '/variant'])
})
test.each(['missing', 'draft', 'throws'] as const)('unpublished page target (%s) refuses both preflight and start', async mode => {
  const { options, req, experiment, executor, payload } = pageFixture()
  const findByPath = vi.fn(async (path: string, _req: import('payload').PayloadRequest) => {
    if (path === '/original') return { id: 10, published: true }
    if (mode === 'throws') throw new Error('secret-value')
    return mode === 'missing' ? null : { id: 11, published: false }
  })
  options.pages = { collections: [{ slug: 'pages', pathOf: doc => `/${doc.slug}`, findByPath }] }
  const result = await preflightData(req, { experimentId: 1, options })
  expect(result!.checks).toContainEqual({ code: 'page-target-unpublished', ok: false, detail: '/variant' })
  await expect(start(req, { experimentId: 1, options })).rejects.toMatchObject({ code: 'page-target-unpublished', message: "/variant isn't a published page. Publish it, or pick another page." })
  expect(findByPath.mock.calls.map(call => call[0])).toEqual(['/original', '/variant', '/original', '/variant', '/original', '/variant'])
  for (const call of findByPath.mock.calls) expect(call[1]).toBe(req)
  expect(experiment.status).toBe('draft')
  expect(executor.calls).toHaveLength(4)
  expect(executor.calls.every(call => call.text.includes('JOIN LATERAL'))).toBe(true)
  expect(JSON.stringify(payload.logs)).not.toContain('secret-value')
})
test('published targets start; holdouts are not looked up, multiple collections resolve paths', async () => {
  const { options, req, experiment } = pageFixture()
  const arms = experiment.arms as import('../../src/types/contracts.js').Arm[]
  arms.forEach(arm => { arm.weight = 45 })
  arms.push({ key: 'holdout', label: 'Holdout', kind: 'holdout', weight: 10, pageTarget: '/unused' })
  const seenTransaction: boolean[] = []
  const findByPath = vi.fn(async (path: string, seen?: import('payload').PayloadRequest) => {
    seenTransaction.push(seen?.transactionID != null)
    return { id: path, published: true }
  })
  options.pages = { collections: [
    { slug: 'articles', pathOf: () => null, findByPath: async () => null },
    { slug: 'pages', pathOf: doc => `/${doc.slug}`, findByPath },
  ] }
  expect((await start(req, { experimentId: 1, options })).doc.status).toBe('running')
  // Preflight, then again under the page-path locks on a detached request (CORE-54).
  expect(findByPath.mock.calls.map(call => call[0])).toEqual(['/original', '/original', '/variant', '/original', '/original', '/variant'])
  // The recheck ran with the transaction id detached, and it is restored afterwards.
  expect(seenTransaction).toEqual([true, true, true, false, false, false])
})
test('Start refuses a page unpublished while it waited on the page-path lock', async () => {
  const { options, req, experiment } = pageFixture()
  let calls = 0
  // Published at preflight, gone once the locks are held (a delete committed meanwhile).
  const findByPath = vi.fn(async (path: string) => (++calls > 2 && path === '/variant') ? null : { id: path, published: true })
  options.pages = { collections: [{ slug: 'pages', pathOf: doc => `/${doc.slug}`, findByPath }] }
  await expect(start(req, { experimentId: 1, options })).rejects.toMatchObject({ code: 'page-target-unpublished' })
  expect(experiment.status).toBe('draft')
})
test('without pages, preflight warns without refusing and start preserves existing behaviour', async () => {
  const { options, req } = pageFixture()
  const result = await preflightData(req, { experimentId: 1, options })
  expect(result!.checks).toContainEqual({ code: 'page-targets-unchecked', ok: true, warning: true })
  expect(result!.checks.every(check => check.ok)).toBe(true)
  expect((await start(req, { experimentId: 1, options })).doc.status).toBe('running')
})

test('Start locks every frozen goal in sorted order after advisory locks and before writing the phase', async () => {
  const { req, options, experiment, executor, payload } = fixture()
  experiment.metrics = { primary: 4, secondary: [2], guardrails: [4] }
  const query = executor.query
  executor.query = async (text, params) => {
    if (text.includes('FOR SHARE')) {
      expect(req.context.xpTransition).toBe(true)
      expect(await req.transactionID).toBeDefined()
      expect(executor.calls.some(call => call.text.includes("hashtext('xp:experiment')"))).toBe(true)
      expect(payload.documents['xp-phases']).toEqual([])
      expect(params).toEqual([[2, 4]])
    }
    return query(text, params)
  }
  await start(req, { experimentId: 1, options })
  expect(executor.calls.filter(call => call.text.includes('FOR SHARE'))).toHaveLength(1)
})

test('Start refuses a goal deleted after preflight without freezing its definition', async () => {
  const { req, options, executor, payload } = fixture()
  const query = executor.query
  executor.query = async (text, params) => text.includes('FOR SHARE') ? { rows: [], rowCount: 0 } : query(text, params)
  await expect(start(req, { experimentId: 1, options })).rejects.toMatchObject({ code: 'stale-draft', status: 409 })
  expect(payload.documents['xp-phases']).toEqual([])
})

test.each(['slug', 'source'])('Start refuses a goal whose %s changed before the freeze lock', async field => {
  const { req, options, executor, payload } = fixture()
  const query = executor.query
  executor.query = async (text, params) => {
    if (text.includes('FOR SHARE')) payload.documents['xp-metrics']![0]![field] = 'changed'
    return query(text, params)
  }
  await expect(start(req, { experimentId: 1, options })).rejects.toMatchObject({ code: 'stale-draft', status: 409 })
  expect(payload.documents['xp-phases']).toEqual([])
})

test.each([['running', 0], ['running', 1], ['decided', 0], ['decided', 1]] as const)('a %s page test blocks sharing arm %s in preflight and Start', async (status, peerArm) => {
  for (const shared of ['/original', '/variant']) {
    const { options, req, payload, executor, occupancy } = pageFixture()
    occupancy.push({ id: 8,
      arms: defaultArms('page').map((arm, index) => ({ ...arm, pageTarget: index === peerArm ? shared + '/' : '/elsewhere' })) })
    const expected = { code: 'page-in-use', ok: false, detail: { paths: [shared] } }
    expect((await preflightData(req, { experimentId: 1, options }))!.checks).toContainEqual(expected)
    await expect(start(req, { experimentId: 1, options })).rejects.toMatchObject({
      code: 'page-in-use', status: 409, detail: expected.detail,
      message: `Another running or decided test already uses ${shared}. Choose a different page, or finish that test first.`,
    })
    expect(executor.calls).toHaveLength(2)
    expect(executor.calls.every(call => call.text.includes('JOIN LATERAL'))).toBe(true)
    expect(payload.documents['xp-phases']).toEqual([])
  }
})

test.each([
  ['page', 'draft'], ['page', 'stopped'], ['page', 'archived'],
  ['block', 'running'], ['block', 'decided'], ['flag', 'running'], ['flag', 'decided'], ['code', 'running'],
])('a %s test in %s does not occupy page targets', async (kind, status) => {
  const { options, req, payload, experiment } = pageFixture()
  const arms = defaultArms('page').map(arm => ({ ...arm, pageTarget: '/original/' }))
  payload.documents['xp-experiments']!.push({ ...experiment, id: 8, slug: 'other', kind, status, arms })
  payload.documents['xp-phases']!.push({ id: 9, experiment: 8, phase: 1, phaseKind: 'test', seed: 'old|', arms, allocation: 100, targeting: [] })
  expect((await start(req, { experimentId: 1, options })).doc.status).toBe('running')
})

test.each(['running', 'decided'])('Start rechecks %s page conflicts after sorted path locks and before any phase write', async status => {
  const { options, req, payload, executor, experiment, occupancy } = pageFixture()
  experiment.layer = 3
  experiment.arms = defaultArms('page').map((arm, index) => ({ ...arm, pageTarget: index ? '/a/' : '/z/' }))
  const query = executor.query
  executor.query = async (text, params) => {
    if (text.includes("hashtext('xp:pagepath')") && params?.[0] === '/z') {
      occupancy.push({ id: 8,
        arms: [{ ...defaultArms('page')[0]!, pageTarget: '/z///' }] })
    }
    return query(text, params)
  }
  await expect(start(req, { experimentId: 1, options })).rejects.toMatchObject({ code: 'page-in-use', detail: { paths: ['/z'] } })
  expect(executor.calls.filter(call => call.text.includes('advisory')).map(call => call.params)).toEqual([['3'], ['1'], ['/a'], ['/z']])
  expect(payload.documents['xp-phases']).toEqual([])
  expect(executor.calls.filter(call => call.text.includes('JOIN LATERAL'))).toHaveLength(2)
  expect(payload.calls.filter(call => call.args.collection === 'xp-experiments' && JSON.stringify(call.args.where).includes('kind'))).toEqual([])
})

test('a stopped page test can start a new round using its own previous pages', async () => {
  const { options, req, experiment } = pageFixture()
  experiment.status = 'stopped'
  experiment.phase = 1
  expect((await start(req, { experimentId: 1, options })).doc).toMatchObject({ status: 'running', phase: 2 })
})


test.each([false, true])('a decided peer occupies frozen /x and leaves edited /y free (rollout=%s)', async rollout => {
  const database = await pageOccupancyDb()
  try {
    const frozen = pageArms('/x')
    await database.addTest(8, 'decided', '/y', [
      { phase: 1, kind: 'test', arms: frozen },
      ...(rollout ? [{ phase: 2, kind: 'rollout' as const, arms: [frozen[1]!] }] : []),
    ])
    for (const path of ['/x', '/y']) {
      const { options, req, executor, experiment, payload } = pageFixture()
      experiment.arms = pageArms(path)
      payload.documents['xp-experiments']!.push({ id: 8, slug: 'peer', kind: 'page', status: 'decided',
        unitType: 'visitor', exposurePolicy: 'pageview', phase: 1, decision: { winnerArm: 'variantA' }, arms: pageArms('/y') })
      payload.documents['xp-phases']!.push({ id: 9, experiment: 8, phase: 1, phaseKind: 'test', seed: 'peer|', arms: frozen, allocation: 100, targeting: [] })
      // Exercise the real occupancy SQL while keeping transition writes and locks fake.
      const query = executor.query
      executor.query = async (text, params) => text.includes('JOIN LATERAL') ? database.exec.query(text, params) : query(text, params)
      if (path === '/x') {
        await expect(start(req, { experimentId: 1, options })).rejects.toMatchObject({
          code: 'page-in-use', detail: { paths: ['/x', '/x/variant'] },
        })
        expect(experiment.status).toBe('draft')
      } else {
        await expect(start(req, { experimentId: 1, options })).resolves.toMatchObject({ doc: { status: 'running' } })
      }
    }
  } finally { await database.close() }
}, 60_000)

test.each([
  ['/x', {}, 'refused'],                                           // the archived Original's path is rewritten to the winner
  ['/x/variant', {}, 'allowed'],                                   // the winner's own path is not rewritten
  ['/x', { pagesReleasedAt: '2026-11-03T00:00:00Z' }, 'allowed'],  // Release pages frees it
  ['/x', { discardedAt: '2026-11-03T00:00:00Z' }, 'allowed'],      // so does a discard
] as const)('a new test on %s next to an archived peer (%j) is %s', async (path, decision, outcome) => {
  const database = await pageOccupancyDb()
  try {
    await database.addTest(8, 'archived', '/x', [{ phase: 1, kind: 'test', arms: pageArms('/x') }], 'page', { winnerArm: 'variantA', ...decision })
    const { options, req, executor, experiment } = pageFixture()
    experiment.arms = pageArms(path).map((arm, index) => index ? { ...arm, pageTarget: `${path}-other` } : arm)
    const query = executor.query
    executor.query = async (text, params) => text.includes('JOIN LATERAL') ? database.exec.query(text, params) : query(text, params)
    if (outcome === 'refused') {
      await expect(start(req, { experimentId: 1, options })).rejects.toMatchObject({ code: 'page-in-use', detail: { paths: [path] } })
    } else {
      await expect(start(req, { experimentId: 1, options })).resolves.toMatchObject({ doc: { status: 'running' } })
    }
  } finally { await database.close() }
}, 60_000)

test.each(['findByPath', 'contentOf'] as const)('a throwing %s comparison preserves preflight, Start and Tests home readiness', async failure => {
  const f = fixture()
  Object.assign(f.payload.db, { defaultIDType: 'number' })
  Object.assign(f.experiment, { kind: 'page', exposurePolicy: 'pageview', pageCollection: 'pages', arms: defaultArms('page').map((arm, i) => ({ ...arm, pageTarget: i ? '/version' : '/original' })) })
  const lookup = vi.fn(async (path: string) => {
    if (failure === 'findByPath') throw new Error('host lookup failed')
    return { id: path === '/original' ? 10 : 11, published: true }
  })
  f.options.pages = { collections: [{ slug: 'pages', pathOf: () => null, findByPath: lookup,
    contentOf: () => { throw new Error('host content failed') } }] }
  f.payload.documents.pages = [{ id: 10, title: 'Original' }, { id: 11, title: 'Version' }]
  Object.assign(f.payload.db, { findOne: vi.fn(async () => ({ _status: 'published', layout: [] })) })
  const { handlePreflight } = await import('../../src/endpoints/preflight.js')
  f.req.routeParams = { id: '1' }
  const preflight = await handlePreflight(f.req, { options: f.options })
  expect(preflight.status).toBe(200)
  const checks = (await preflight.json()).checks
  expect(checks.some((check: { code: string }) => check.code === 'version-identical')).toBe(false)
  if (failure === 'findByPath') expect(checks).toContainEqual(expect.objectContaining({ code: 'page-target-unpublished', ok: false }))
  const { handleSummary } = await import('../../src/endpoints/summary.js')
  Object.assign(f.req, { url: 'https://host/api/xp/experiments/summary?ids=1' })
  const home = await (await handleSummary(f.req, { options: f.options })).json()
  expect(home['1'].ready).toBe(failure !== 'findByPath')
  if (failure === 'findByPath') {
    expect(home['1'].next.code).toBe('page-target-unpublished')
    await expect(start(f.req, { experimentId: 1, options: f.options })).rejects.toMatchObject({ code: 'page-target-unpublished', status: 422 })
  } else {
    await expect(start(f.req, { experimentId: 1, options: f.options })).resolves.toMatchObject({ doc: { status: 'running' } })
  }
  expect(f.payload.logs.some(log => log.args.includes('Experiment version comparison failed'))).toBe(true)
})

test('preflight page placements treat a failed title read as unavailable', async () => {
  const f = fixture()
  Object.assign(f.payload.db, { defaultIDType: 'number' })
  Object.assign(f.experiment, { kind: 'page', exposurePolicy: 'pageview', arms: defaultArms('page').map((arm, i) => ({ ...arm, pageTarget: i ? '/version' : '/original' })) })
  f.options.pages = { collections: [{ slug: 'pages', pathOf: () => null, findByPath: async () => ({ id: 10, published: true }) }] }
  const read = f.payload.findByID.bind(f.payload)
  vi.spyOn(f.payload, 'findByID').mockImplementation(async args => {
    if (args.collection === 'pages') throw new Error('page title lookup failed')
    return read(args)
  })
  const { handlePreflight } = await import('../../src/endpoints/preflight.js')
  f.req.routeParams = { id: '1' }
  const response = await handlePreflight(f.req, { options: f.options })
  expect(response.status).toBe(200)
  expect((await response.json()).pagePlacements).toEqual([
    { arm: 'control', path: '/original', collection: 'pages', id: null, published: false },
    { arm: 'variantA', path: '/version', collection: 'pages', id: null, published: false },
  ])
})

function blockFixture() {
  const f = fixture()
  Object.assign(f.experiment, { kind: 'block', exposurePolicy: 'render', arms: defaultArms('block') })
  f.options.blocks = { collections: [{ slug: 'pages', field: 'layout' }] }
  f.options.pages = { collections: [{ slug: 'pages', pathOf: doc => `/${doc.slug}`, findByPath: async () => null }] }
  const layout = [{ blockType: 'xpExperiment', experiment: 'hero', slots: [
    { slot: 'control', blocks: [{ blockType: 'text' }] }, { slot: 'variantA', blocks: [{ blockType: 'text' }] },
  ] }]
  f.payload.documents.pages = [{ id: 10, title: 'Landing', slug: 'landing', _status: 'published', layout, secret: { doc: 'private host value' } }]
  return f
}

// Measured below 100 ms locally; each cap leaves CI headroom.
test.each(['placement-unpublished', 'duplicate-version-row', 'empty-slot'])('preflight and Start %s bodies contain only placement identifiers', async code => {
  const f = blockFixture(), page = f.payload.documents.pages![0]!
  const layout = page.layout as Array<{ slots: Array<{ slot: string; blocks: unknown[] }> }>
  if (code === 'placement-unpublished') page._status = 'draft'
  if (code === 'duplicate-version-row') layout[0]!.slots.push(structuredClone(layout[0]!.slots[0]!))
  if (code === 'empty-slot') layout[0]!.slots[1]!.blocks = []
  Object.assign(f.payload.db, { defaultIDType: 'number' })
  f.req.routeParams = { id: '1' }; f.req.data = {}
  const { handlePreflight } = await import('../../src/endpoints/preflight.js')
  const { handleStart } = await import('../../src/endpoints/transitions.js')
  const review = await handlePreflight(f.req, { options: f.options })
  const refusal = await handleStart(f.req, { options: f.options })
  const bodies = [await review.json(), await refusal.json()]
  expect(refusal.status).toBe(422)
  expect(bodies[1]).toMatchObject({ errors: [{ code, detail: [{ collection: 'pages', id: 10, title: 'Landing' }] }] })
  if (code === 'empty-slot') {
    const { READINESS } = await import('../../src/admin/surface/readiness/readiness.model.js')
    expect(READINESS['empty-slot'].next(bodies[1].errors[0].detail, { arms: defaultArms('block'), unitType: 'visitor' })).toBe('Add content for Variant A on the page.')
  }
  function assertNoDoc(value: unknown) {
    if (!value || typeof value !== 'object') return
    expect(Object.keys(value)).not.toContain('doc')
    for (const item of Object.values(value)) assertNoDoc(item)
  }
  for (const body of bodies) { assertNoDoc(JSON.parse(JSON.stringify(body))); expect(JSON.stringify(body)).not.toContain('private host value') }
}, 5000)

test('Start itself refuses interacting-tests found after its experiment lock', async () => {
  const f = blockFixture(), query = f.executor.query
  f.executor.query = async (text, params) => {
    if (text.includes("hashtext('xp:experiment')")) f.occupancy.push({ id: 2, slug: 'page-test', name: 'Page test', status: 'running', kind: 'page', arms: pageArms('/landing') } as never)
    return query(text, params)
  }
  await expect(start(f.req, { experimentId: 1, options: f.options })).rejects.toMatchObject({ code: 'interacting-tests', status: 409 })
  expect(f.payload.documents['xp-phases']).toEqual([])
}, 5000)

test('Start itself refuses placements-changed after a new placement appears during lock acquisition', async () => {
  const f = blockFixture(), query = f.executor.query
  f.executor.query = async (text, params) => {
    if (text.includes("hashtext('xp:pagepath')")) f.payload.documents.pages!.push({ ...structuredClone(f.payload.documents.pages![0]!), id: 11, slug: 'new-placement' })
    return query(text, params)
  }
  await expect(start(f.req, { experimentId: 1, options: f.options })).rejects.toMatchObject({ code: 'placements-changed', status: 409 })
  expect(f.payload.documents['xp-phases']).toEqual([])
}, 5000)

test('click primary starts for signed-in users and freezes a binomial increase metric without a cap', async () => {
  const f = fixture()
  f.experiment.unitType = 'user'
  Object.assign(f.payload.documents['xp-metrics']![0]!, { source: 'click:join', slug: 'join', direction: 'increase', capping: { type: 'absolute', value: 5 } })
  await start(f.req, { experimentId: 1, options: f.options })
  expect(f.payload.documents['xp-phases']![0]!.metricDefinitions).toEqual([expect.objectContaining({ source: 'click:join', role: 'primary', kind: 'binomial', direction: 'increase', resolvedCap: null, capping: null })])
})
test('Start rechecks click primary fairness after locks using detached published reads', async () => {
  const f = fixture()
  f.experiment.kind = 'page'; f.experiment.exposurePolicy = 'pageview'; f.experiment.targeting = []
  f.experiment.pageCollection = 'pages'
  f.experiment.arms = defaultArms('page').map((arm, i) => ({ ...arm, pageTarget: i ? '/b' : '/a' }))
  Object.assign(f.payload.documents['xp-metrics']![0]!, { source: 'click:join', slug: 'join' })
  f.options.pages = { collections: [{ slug: 'pages', pathOf: d => String(d.path), findByPath: async path => ({ id: path === '/a' ? 7 : 8, published: true }), contentOf: d => d.layout }] }
  Object.assign(f.payload.config, { collections: [{ slug: 'pages', versions: { drafts: true } }] })
  Object.assign(f.payload.db, { findOne: vi.fn(async ({ where }: { where: { id: { equals: number } } }) => {
    const locked = f.executor.calls.some(call => call.text.includes("hashtext('xp:pagepath')"))
    expect(f.req.transactionID).toBeUndefined()
    return { id: where.id.equals, _status: 'published', path: where.id.equals === 7 ? '/a' : '/b', layout: locked && where.id.equals === 8 ? [] : [{ xpGoal: 'join' }] }
  }) })
  await expect(start(f.req, { experimentId: 1, options: f.options })).rejects.toMatchObject({ code: 'goal-in-some-versions' })
  expect(f.payload.documents['xp-phases']).toEqual([])
})
