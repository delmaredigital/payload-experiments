import { createLocalReq } from 'payload'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { createIntegrationHarness } from './harness.js'
import { sampleOptions } from '../tests/collections/fixtures.js'
import { handleStart, handleStop } from '../src/endpoints/transitions.js'
import { handleSummary } from '../src/endpoints/summary.js'
import fixture from '../tests/_fixtures/snapshots/T7.json'

// Train-only: the harness selects serial / uuid from XP_IT_ID_TYPE. Never run in a lane.
let harness: Awaited<ReturnType<typeof createIntegrationHarness>>
beforeAll(async () => { harness = await createIntegrationHarness() }, 60_000)
afterAll(async () => { await harness?.teardown() })

test('HTTP handlers accept string route ids and a re-encoded summary list', async () => {
  const { payload } = harness
  const options = sampleOptions()
  const req = await createLocalReq({}, payload)
  const metric = await payload.create({ collection: 'xp-metrics', req, overrideAccess: true,
    data: { name: 'HTTP routes', slug: 'http-routes', source: 'binomial', direction: 'increase' } })
  const ids: Array<string | number> = []
  for (const suffix of ['first', 'second']) {
    const draft = await payload.create({ collection: 'xp-experiments', req, overrideAccess: true, data: {
      name: `HTTP ${suffix}`, slug: `http-${suffix}`, kind: 'code', unitType: 'user', allocation: 100, exposurePolicy: 'manual',
      arms: [
        { key: 'control', label: 'Original', kind: 'control', weight: 50 },
        { key: 'variantA', label: 'Variant A', kind: 'variant', weight: 50 },
      ], metrics: { primary: metric.id }, analysis: { plannedDurationDays: 14, reachPerDay: 100 },
    } })
    expect(typeof draft.id).toBe(process.env.XP_IT_ID_TYPE === 'uuid' ? 'string' : 'number')
    ids.push(draft.id)
    // Payload HTTP routing always delivers strings, including on serial-id hosts.
    const routeReq = await createLocalReq({ req: { routeParams: { id: String(draft.id) }, data: {} } }, payload)
    const started = await handleStart(routeReq, { options })
    expect(started.status).toBe(200)
    expect(await started.json()).toMatchObject({ doc: { id: draft.id, status: 'running' } })
    const stopped = await handleStop(routeReq, { options })
    expect(stopped.status).toBe(200)
    expect(await stopped.json()).toMatchObject({ doc: { id: draft.id, status: 'stopped' } })
    const phases = await payload.find({ collection: 'xp-phases', req, overrideAccess: true, depth: 0,
      where: { experiment: { equals: draft.id } } })
    expect(phases.docs).toHaveLength(1)
    expect(phases.docs[0]).toMatchObject({ experiment: draft.id, phase: 1, endedAt: expect.any(String) })
    await payload.create({ collection: 'xp-results-snapshots', req, overrideAccess: true,
      data: { experiment: draft.id, phase: 1, computedAt: new Date().toISOString(), window: fixture.window, snapshot: fixture } })
  }
  const summaryReq = await createLocalReq({ req: {
    url: `http://localhost/api/xp/experiments/summary?ids=${encodeURIComponent([...ids].reverse().join(','))}`,
  } }, payload)
  const response = await handleSummary(summaryReq, { options })
  expect(response.status).toBe(200)
  const summary = await response.json()
  expect(Object.keys(summary).sort()).toEqual(ids.map(String).sort())
  for (const id of ids) expect(summary[String(id)]).toMatchObject({ exposures: fixture.exposures.total,
    verdict: { code: fixture.verdict.code, headline: fixture.verdict.headline } })
})
