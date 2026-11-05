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
  return { options, payload, executor, req, experiment, manifests }
}
import { addMetric } from '../../src/transitions/addMetric.js'

test.each(['secondary', 'guardrail'] as const)('appends frozen %s with addedAt, keeps manifest revision unchanged', async role => {
  const { req, payload, options, executor, experiment } = fixture('running')
  const result = await addMetric(req, { experimentId: 1, metric: 4, role, options })
  expect(result.revision).toBe(8)
  expect(experiment.metrics).toEqual({ primary: 2, [role === 'guardrail' ? 'guardrails' : 'secondary']: [4] })
  expect(payload.documents['xp-phases']![0]!.metricDefinitions).toEqual([
    { id: 2, metricId: 2, role: 'primary' },
    expect.objectContaining({ id: 4, metricId: 4, name: 'Gifts', role, addedAt: expect.any(String), resolvedCap: null, historyUnits: 0 }),
  ])
  expect(executor.calls.some(call => call.text.includes("hashtext('xp:state')"))).toBe(false)
  payload.documents['xp-metrics']![1]!.name = 'Changed'
  expect((payload.documents['xp-phases']![0]!.metricDefinitions as Array<{ name: string }>)[1]!.name).toBe('Gifts')
})
test.each(['draft', 'stopped', 'decided', 'archived'])('refuses %s', async status => {
  const { req, options } = fixture(status)
  await expect(addMetric(req, { experimentId: 1, metric: 4, role: 'secondary', options })).rejects.toMatchObject({ code: 'invalid-status' })
})
test('primary and already added metrics cannot be added again or moved between roles', async () => {
  const { req, options } = fixture('running')
  await expect(addMetric(req, { experimentId: 1, metric: 2, role: 'secondary', options })).rejects.toMatchObject({ code: 'duplicate-metric' })
  // The fake does not roll back writes, but refusals above wrote nothing.
  await addMetric(req, { experimentId: 1, metric: 4, role: 'secondary', options })
  await expect(addMetric(req, { experimentId: 1, metric: 4, role: 'guardrail', options })).rejects.toMatchObject({ code: 'duplicate-metric' })
})
test('missing metric or experiment returns 404', async () => {
  const { req, options } = fixture('running')
  for (const [experimentId, metric] of [[1, 99], [99, 4]]) await expect(addMetric(req, { experimentId: experimentId!, metric: metric!, role: 'secondary', options })).rejects.toMatchObject({ code: 'not-found', status: 404 })
})
test('visitor-only source cannot be added to a user experiment', async () => {
  const { req, options, experiment } = fixture('running')
  experiment.unitType = 'user'
  options.metricSources!.find(source => source.id === 'revenue')!.keyedBy = 'visitor'
  await expect(addMetric(req, { experimentId: 1, metric: 4, role: 'secondary', options })).rejects.toMatchObject({ code: 'unit-source-mismatch' })
})
test('rechecks running status after the history query', async () => {
  const { req, options, experiment } = fixture('running')
  options.metricSources!.find(source => source.id === 'revenue')!.query = async () => { experiment.status = 'stopped'; return [] }
  await expect(addMetric(req, { experimentId: 1, metric: 4, role: 'secondary', options })).rejects.toMatchObject({ code: 'invalid-status' })
})

test('addMetric locks the goal inside the transaction after advisory locks and before appending', async () => {
  const { req, options, executor, payload } = fixture('running')
  const query = executor.query
  executor.query = async (text, params) => {
    if (text.includes('FOR SHARE')) {
      expect(req.context.xpTransition).toBe(true)
      expect(await req.transactionID).toBeDefined()
      expect(executor.calls.some(call => call.text.includes("hashtext('xp:experiment')"))).toBe(true)
      expect(payload.documents['xp-phases']![0]!.metricDefinitions).toHaveLength(1)
      expect(params).toEqual([[4]])
    }
    return query(text, params)
  }
  await addMetric(req, { experimentId: 1, metric: 4, role: 'secondary', options })
  expect(executor.calls.filter(call => call.text.includes('FOR SHARE'))).toHaveLength(1)
})

test('addMetric refuses a goal deleted after its initial lookup without appending it', async () => {
  const { req, options, executor, payload } = fixture('running')
  const query = executor.query
  executor.query = async (text, params) => text.includes('FOR SHARE') ? { rows: [], rowCount: 0 } : query(text, params)
  await expect(addMetric(req, { experimentId: 1, metric: 4, role: 'secondary', options })).rejects.toMatchObject({ code: 'stale-draft', status: 409 })
  expect(payload.documents['xp-phases']![0]!.metricDefinitions).toHaveLength(1)
})

test.each(['slug', 'source'])('addMetric refuses a goal whose %s changed during history lookup', async field => {
  const { req, options, executor, payload, experiment } = fixture('running')
  options.metricSources!.find(source => source.id === 'revenue')!.query = async () => {
    expect(executor.calls).toEqual([])
    payload.documents['xp-metrics']![1]![field] = 'changed'
    return []
  }
  await expect(addMetric(req, { experimentId: 1, metric: 4, role: 'secondary', options })).rejects.toMatchObject({ code: 'stale-draft', status: 409 })
  expect(payload.documents['xp-phases']![0]!.metricDefinitions).toHaveLength(1)
  expect(experiment.metrics).toEqual({ primary: 2 })
})

test.each(['secondary', 'guardrail'] as const)('click %s fairness is computed before the transition; guardrail refuses, secondary warns', async role => {
  const f = fixture('running')
  f.experiment.kind = 'page'; f.experiment.pageCollection = 'pages'
  f.experiment.arms = defaultArms('page').map((arm, i) => ({ ...arm, pageTarget: i ? '/b' : '/a' }))
  Object.assign(f.payload.documents['xp-metrics']![1]!, { source: 'click:join', slug: 'join' })
  f.options.pages = { collections: [{ slug: 'pages', pathOf: d => String(d.path), findByPath: async path => ({ id: path === '/a' ? 7 : 8, published: true }), contentOf: d => d.layout }] }
  Object.assign(f.payload.config, { collections: [{ slug: 'pages', versions: { drafts: true } }] })
  Object.assign(f.payload.db, { findOne: vi.fn(async ({ where }: { where: { id: { equals: number } } }) => {
    expect(f.req.context.xpTransition).not.toBe(true)
    expect(f.executor.calls.some(c => c.text.includes('pg_advisory'))).toBe(false)
    return { id: where.id.equals, _status: 'published', layout: where.id.equals === 7 ? [{ xpGoal: 'join' }] : [] }
  }) })
  if (role === 'guardrail') {
    await expect(addMetric(f.req, { experimentId: 1, metric: 4, role, options: f.options })).rejects.toMatchObject({ code: 'goal-in-some-versions' })
    expect(f.payload.documents['xp-phases']![0]!.metricDefinitions).toHaveLength(1)
  } else {
    const result = await addMetric(f.req, { experimentId: 1, metric: 4, role, options: f.options })
    expect(result.warnings.map(w => w.code)).toEqual(['goal-in-some-versions', 'goal-added-mid-test'])
  }
})


test.each(['secondary', 'guardrail'] as const)('add-metric reports unchecked placements and judges readable arms for a %s goal', async role => {
  for (const disagree of [false, true]) {
    const f = fixture('running')
    Object.assign(f.experiment, { kind: 'page', pageCollection: 'pages', arms: [
      ...defaultArms('page').map((arm, i) => ({ ...arm, weight: i ? 33 : 34, pageTarget: i ? '/b' : '/a' })),
      { key: 'variantB', kind: 'variant', label: 'B', weight: 33, pageTarget: '/unreadable' },
    ] })
    Object.assign(f.payload.documents['xp-metrics']![1]!, { source: 'click:join', slug: 'join' })
    f.options.pages = { collections: [{ slug: 'pages', pathOf: () => '/', findByPath: async path => ({ id: path === '/a' ? 7 : path === '/b' ? 8 : 9, published: true }), contentOf: doc => doc.layout }] }
    f.payload.documents.pages = [{ id: 7, layout: [{ xpGoal: 'join' }] }, { id: 8, layout: disagree ? [] : [{ xpGoal: 'join' }] }]
    const find = f.payload.db.findOne.bind(f.payload.db)
    vi.spyOn(f.payload.db, 'findOne').mockImplementation(async args => {
      if ((args.where?.id as { equals?: number })?.equals === 9) throw new Error('unreadable')
      return find(args)
    })
    const result = addMetric(f.req, { experimentId: 1, metric: 4, role, options: f.options })
    if (disagree && role === 'guardrail') {
      await expect(result).rejects.toMatchObject({ code: 'goal-in-some-versions' })
      expect(f.payload.documents['xp-phases']![0]!.metricDefinitions).toHaveLength(1)
    } else {
      expect((await result).warnings).toEqual([
        ...(disagree ? [{ code: 'goal-in-some-versions', detail: { metricId: 4, name: 'Gifts' } }] : []),
        { code: 'placement-unchecked', detail: { collection: 'pages', path: '/unreadable' } },
        { code: 'goal-added-mid-test', detail: { metricId: 4 } },
      ])
    }
  }
}, 5_000) // Measured 8 ms locally; cap exceeds 3×.

test('add-metric excludes missing or unpublished version pages without an unchecked warning when readable arms agree', async () => {
  for (const missing of [true, false]) {
    const f = fixture('running')
    Object.assign(f.experiment, { kind: 'page', pageCollection: 'pages', arms: [
      ...defaultArms('page').map((arm, i) => ({ ...arm, weight: i ? 33 : 34, pageTarget: i ? '/b' : '/a' })),
      { key: 'variantB', kind: 'variant', label: 'B', weight: 33, pageTarget: '/unavailable' },
    ] })
    Object.assign(f.payload.documents['xp-metrics']![1]!, { source: 'click:join', slug: 'join' })
    f.payload.documents.pages = [{ id: 7, layout: [{ xpGoal: 'join' }] }, { id: 8, layout: [{ xpGoal: 'join' }] }]
    f.options.pages = { collections: [{ slug: 'pages', pathOf: () => '/', contentOf: doc => doc.layout,
      findByPath: async path => path === '/unavailable' ? (missing ? null : { id: 9, published: false })
        : { id: path === '/a' ? 7 : 8, published: true },
    }] }
    const result = await addMetric(f.req, { experimentId: 1, metric: 4, role: 'secondary', options: f.options })
    expect(result.warnings).toEqual([{ code: 'goal-added-mid-test', detail: { metricId: 4 } }])
    expect(f.payload.logs.filter(log => log.level === 'error')).toEqual([])
  }
}, 5_000) // Measured 3 ms locally; cap exceeds 3×.
