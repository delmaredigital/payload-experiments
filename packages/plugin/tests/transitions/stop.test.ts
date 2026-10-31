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
import { stop } from '../../src/transitions/stop.js'

test('stop clears slices, ends only the current phase and bumps the manifest', async () => {
  const { req, payload, experiment, manifests } = fixture('running', true)
  payload.documents['xp-phases']!.push({ id: 10, experiment: 1, phase: 0 })
  const result = await stop(req, { experimentId: 1 })
  expect(result).toMatchObject({ doc: { status: 'stopped', layerSlices: [] }, revision: 9 })
  expect(experiment.seed).toBe('old|')
  expect(payload.documents['xp-phases']![0]!.endedAt).toBe(result.doc.stoppedAt)
  expect(payload.documents['xp-phases']![1]).not.toHaveProperty('endedAt')
  expect(manifests[0]).toMatchObject({ experiments: [] })
  await expect(stop(req, { experimentId: 1 })).rejects.toMatchObject({ code: 'invalid-status' })
})
test.each(['draft', 'stopped', 'decided', 'archived'])('refuses %s', async status => {
  const { req } = fixture(status)
  await expect(stop(req, { experimentId: 1 })).rejects.toMatchObject({ code: 'invalid-status' })
})
test('unknown experiment and missing phase are 404', async () => {
  const { req, payload } = fixture('running')
  await expect(stop(req, { experimentId: 99 })).rejects.toMatchObject({ code: 'not-found', status: 404 })
  payload.documents['xp-phases'] = []
  await expect(stop(req, { experimentId: 1 })).rejects.toMatchObject({ code: 'not-found', status: 404 })
})
test('rechecks status after taking the layer and experiment locks', async () => {
  const { req, executor, experiment } = fixture('running', true)
  const query = executor.query
  executor.query = async (text, params) => { experiment.status = 'decided'; return query(text, params) }
  await expect(stop(req, { experimentId: 1 })).rejects.toMatchObject({ code: 'invalid-status' })
})
