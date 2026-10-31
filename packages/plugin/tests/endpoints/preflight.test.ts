import { expect, test, vi } from 'vitest'
import { handlePreflight } from '../../src/endpoints/preflight.js'
import { buildEndpoints } from '../../src/endpoints/index.js'
import { fakePayload } from '../_fakes/payload.js'
import { fakeReq } from '../_fakes/req.js'
import { sampleOptions } from '../collections/fixtures.js'
import { defaultArms } from '../../src/collections/experiments/armInvariants.js'
import type { PreflightResult } from '../../src/types/endpoints.js'

function setup(kind: 'flag' | 'code' = 'code') {
  const options = sampleOptions()
  const payload = fakePayload({ overrides: { findGlobal: vi.fn(async () => ({ flagDefaults: {} })) }, collections: {
    'xp-experiments': [{ id: 'one', slug: 'hero', status: 'draft', kind, unitType: 'visitor', allocation: 100, flagPoint: 'cta', arms: defaultArms(kind),
      exposurePolicy: 'manual', analysis: { plannedDurationDays: 14, reachPerDay: 100 }, metrics: { primary: 2 } }],
    'xp-metrics': [{ id: 2, source: 'binomial' }],
  } })
  const req = fakeReq({ payload, user: { id: 1 }, routeParams: { id: 'one' } })
  return { options, payload, req }
}
test('GET preflight has the frozen shape, does not cache, and performs no writes', async () => {
  const { options, payload, req } = setup()
  const route = buildEndpoints({ options }).find(route => route.path === '/xp/experiments/:id/preflight')!
  expect(route.method).toBe('get')
  const response = await route.handler(req)
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('no-store')
  const body = await response.json() as PreflightResult
  expect(Object.keys(body).sort()).toEqual(['baseline', 'checks', 'estimate', 'placements', 'trafficPerDay'])
  expect(body.checks.every(check => check.ok)).toBe(true)
  expect(body.baseline).toEqual({ metricId: 2, value: 0, days: 28 })
  expect(body.trafficPerDay).toBe(100)
  expect(body.estimate).toBeNull()
  expect(body.placements).toEqual([])
  expect(payload.calls.every(call => call.method === 'find' && call.args.overrideAccess === false && call.args.req === req)).toBe(true)
  expect(payload.dbCalls).toEqual([])
})
test('unknown id returns a 404 not-found envelope', async () => {
  const { options, req } = setup()
  req.routeParams = { id: 'missing' }
  const response = await handlePreflight(req, { options })
  expect(response.status).toBe(404)
  expect(await response.json()).toEqual({ errors: [{ code: 'not-found', message: 'Experiment not found' }] })
})
test('a throwing host placement hook returns a failed check with detail, not 500', async () => {
  const { options, req } = setup('flag')
  options.flagPoints![0]!.placements = async () => { throw new Error('Content adapter unavailable') }
  const response = await handlePreflight(req, { options })
  expect(response.status).toBe(200)
  expect((await response.json()).checks).toContainEqual({ code: 'flag-placement-missing', ok: false, detail: 'Content adapter unavailable' })
})
test('host missing-arm rows remain visible to the Review tab', async () => {
  const { options, req } = setup('flag')
  options.flagPoints![0]!.placements = async () => [{ arm: 'control', ok: true }, { arm: 'variantA', ok: false, detail: 'No published ask' }]
  const response = await handlePreflight(req, { options })
  const body = await response.json() as PreflightResult
  expect(body.checks).toContainEqual(expect.objectContaining({ code: 'flag-placement-missing', ok: false }))
  expect(body.placements).toContainEqual({ collection: 'cta', id: 'variantA', title: 'variantA', ok: false, detail: 'No published ask' })
})
test('block read failure reports a failed placement check', async () => {
  const { options, req, payload } = setup()
  payload.documents['xp-experiments']![0]!.kind = 'block'
  options.puck = { enabled: true, collections: ['pages'] }
  const original = payload.find
  vi.spyOn(payload, 'find').mockImplementation(async args => {
    if (args.collection === 'pages') throw new Error('Page read denied')
    return original(args)
  })
  const response = await handlePreflight(req, { options })
  expect(response.status).toBe(200)
  expect((await response.json()).checks).toContainEqual({ code: 'no-placements', ok: false, detail: 'Page read denied' })
})
