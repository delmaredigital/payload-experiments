import { expect, test, vi, beforeEach } from 'vitest'
import { handleStart, handleAllocate, handleAddMetric, handleStop } from '../../src/endpoints/transitions.js'
import * as starts from '../../src/transitions/start.js'
import * as allocations from '../../src/transitions/allocate.js'
import * as metrics from '../../src/transitions/addMetric.js'
import * as stops from '../../src/transitions/stop.js'
import { XpRefusal } from '../../src/errors.js'
import { fakeReq } from '../_fakes/req.js'
import { fakePayload } from '../_fakes/payload.js'
import { sampleOptions } from '../collections/fixtures.js'

beforeEach(() => vi.restoreAllMocks())
const cases = [
  { handler: handleStart, module: starts, name: 'start', body: {} },
  { handler: handleAllocate, module: allocations, name: 'allocate', body: { allocation: 50 } },
  { handler: handleAddMetric, module: metrics, name: 'addMetric', body: { metric: 4, role: 'secondary' } },
  { handler: handleStop, module: stops, name: 'stop', body: {} },
] as const
for (const row of cases) {
  test(`${row.name}: success returns doc and revision`, async () => {
    const req = fakeReq({ routeParams: { id: '1' }, body: JSON.stringify(row.body) })
    const result = { doc: { id: 1, status: 'running' }, revision: 5 }
    const spy = vi.spyOn(row.module as typeof starts, row.name as 'start').mockResolvedValue(result as Awaited<ReturnType<typeof starts.start>>)
    const response = await row.handler(req, { options: sampleOptions() })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(result)
    expect(spy).toHaveBeenCalledWith(req, expect.objectContaining({ experimentId: '1' }))
  })
  test.each(['null', '[]', '"bad"', '{', '{"extra":1}'])(`${row.name}: invalid body %s returns 400`, async body => {
    const response = await row.handler(fakeReq({ body, routeParams: { id: '1' } }), { options: sampleOptions() })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ errors: [{ code: 'invalid-body' }] })
  })
  test(`${row.name}: unknown id returns 404`, async () => {
    const response = await row.handler(fakeReq({ body: JSON.stringify(row.body), routeParams: { id: '99' }, payload: fakePayload() }), { options: sampleOptions() })
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ errors: [{ code: 'not-found' }] })
  })
  test(`${row.name}: preserves refusal status, code and detail`, async () => {
    vi.spyOn(row.module as typeof starts, row.name as 'start').mockRejectedValue(new XpRefusal('layer-full', 'Layer full', { available: 1 }, 409))
    const response = await row.handler(fakeReq({ body: JSON.stringify(row.body), routeParams: { id: '1' } }), { options: sampleOptions() })
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ errors: [{ code: 'layer-full', message: 'Layer full', detail: { available: 1 } }] })
  })
}
test.each([{}, { allocation: 0 }, { allocation: 101 }, { allocation: 1.5 }, { allocation: '50' }])('allocate validates %j', async body => {
  expect((await handleAllocate(fakeReq({ body: JSON.stringify(body) }), { options: sampleOptions() })).status).toBe(400)
})
test.each([{}, { metric: 2, role: 'primary' }, { metric: {}, role: 'secondary' }, { metric: '', role: 'guardrail' }])('addMetric validates %j', async body => {
  expect((await handleAddMetric(fakeReq({ body: JSON.stringify(body) }), { options: sampleOptions() })).status).toBe(400)
})
test.each([handleStart, handleStop])('bodyless request is accepted and missing id returns 404', async handler => {
  expect((await handler(fakeReq(), { options: sampleOptions() })).status).toBe(404)
})
