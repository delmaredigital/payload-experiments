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
import { start } from '../../src/transitions/start.js'
import { stop } from '../../src/transitions/stop.js'

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
  ['page-user-unit', { kind: 'page', unitType: 'user', arms: defaultArms('page').map(arm => ({ ...arm, pageTarget: '/x' })) }],
  ['flag-no-point', { kind: 'flag' }], ['no-placements', { kind: 'block', arms: defaultArms('block') }],
  ['invalid-body', { targeting: [{ attribute: 'unknown', op: 'eq', value: 'x' }] }],
])('first failing check %s is returned without opening a transaction', async (code, changes) => {
  const { req, options, experiment, executor } = fixture()
  Object.assign(experiment, changes)
  await expect(start(req, { experimentId: 1, options })).rejects.toMatchObject({ code })
  expect(executor.calls).toEqual([])
})
test.each([
  { attribute: 'age', op: 'eq', value: 'wrong' }, { attribute: 'age', op: 'contains', value: 1 },
  { attribute: 'country', op: 'in', value: [] },
])('invalid typed rule %j is refused', async rule => {
  const { req, options, experiment } = fixture()
  experiment.targeting = [rule]
  await expect(start(req, { experimentId: 1, options })).rejects.toMatchObject({ code: 'invalid-body' })
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
