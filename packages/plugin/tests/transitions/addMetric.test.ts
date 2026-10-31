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
  await expect(addMetric(req, { experimentId: 1, metric: 2, role: 'secondary', options })).rejects.toMatchObject({ code: 'invalid-body' })
  // The fake does not roll back writes, but refusals above wrote nothing.
  await addMetric(req, { experimentId: 1, metric: 4, role: 'secondary', options })
  await expect(addMetric(req, { experimentId: 1, metric: 4, role: 'guardrail', options })).rejects.toMatchObject({ code: 'invalid-body' })
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
