import { expect, test, vi, beforeEach } from 'vitest'
import { handleStart, handleAllocate, handleAddMetric, handleStop, handleDecide, handleReleaseHoldout, handleReleasePages, handleArchive, handleMakeContent } from '../../src/endpoints/transitions.js'
import * as starts from '../../src/transitions/start.js'
import * as allocations from '../../src/transitions/allocate.js'
import * as metrics from '../../src/transitions/addMetric.js'
import * as stops from '../../src/transitions/stop.js'
import * as decisions from '../../src/transitions/decide.js'
import * as releases from '../../src/transitions/releaseHoldout.js'
import * as pageReleases from '../../src/transitions/releasePages.js'
import * as contents from '../../src/transitions/makeContent.js'
import * as archives from '../../src/transitions/archive.js'
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
  { handler: handleDecide, module: decisions, name: 'decide', body: { winnerArm: 'variantA' } },
  { handler: handleReleaseHoldout, module: releases, name: 'releaseHoldout', body: {} },
  { handler: handleReleasePages, module: pageReleases, name: 'releasePages', body: {} },
  { handler: handleMakeContent, module: contents, name: 'makeContent', body: {} },
  { handler: handleArchive, module: archives, name: 'archive', body: { mode: 'discard' } },
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
  test(`${row.name}: returns 422 for a well-formed refusal, preserving code and detail`, async () => {
    vi.spyOn(row.module as typeof starts, row.name as 'start').mockRejectedValue(new XpRefusal('layer-full', 'Layer full', { available: 1 }, 409))
    const response = await row.handler(fakeReq({ body: JSON.stringify(row.body), routeParams: { id: '1' } }), { options: sampleOptions() })
    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({ errors: [{ code: 'layer-full', message: 'Layer full', detail: { available: 1 } }] })
  })
}
test.each([{}, { allocation: 0 }, { allocation: 101 }, { allocation: 1.5 }, { allocation: '50' }])('allocate validates %j', async body => {
  expect((await handleAllocate(fakeReq({ body: JSON.stringify(body) }), { options: sampleOptions() })).status).toBe(400)
})
test.each([{}, { metric: 2, role: 'primary' }, { metric: {}, role: 'secondary' }, { metric: '', role: 'guardrail' }])('addMetric validates %j', async body => {
  expect((await handleAddMetric(fakeReq({ body: JSON.stringify(body) }), { options: sampleOptions() })).status).toBe(400)
})
test.each([handleStart, handleStop, handleMakeContent, handleReleasePages])('bodyless request is accepted and missing id returns 404', async handler => {
  expect((await handler(fakeReq(), { options: sampleOptions() })).status).toBe(404)
})

test.each([
  [handleDecide, { winnerArm: 1 }], [handleDecide, { winnerArm: 'variantA', note: 3 }],
  [handleDecide, { winnerArm: 'variantA', confirmation: null }], [handleArchive, { mode: 'invalid' }],
  [handleArchive, { mode: 'discard', confirmation: 4 }],
])('validates the declared schema', async (handler, body) => {
  expect((await handler(fakeReq({ body: JSON.stringify(body) }), { options: sampleOptions() })).status).toBe(400)
})
test.each(['undeclared-targeting-key', 'duplicate-metric', 'invalid-winner', 'confirmation-required', 'invalid-status', 'slices-taken'] as const)('keeps refusal code %s distinct', async code => {
  vi.spyOn(decisions, 'decide').mockRejectedValue(new XpRefusal(code, 'Refused', undefined, 422))
  const response = await handleDecide(fakeReq({ body: '{"winnerArm":"variantA"}', routeParams: { id: '1' } }), { options: sampleOptions() })
  expect(response.status).toBe(422)
  expect(await response.json()).toMatchObject({ errors: [{ code }] })
})

test('make-content preserves locked-placement as a 422 refusal', async () => {
  vi.spyOn(contents, 'makeContent').mockRejectedValue(new XpRefusal('locked-placement', 'Finish editing the page and try again.', { id: 2 }, 422))
  const response = await handleMakeContent(fakeReq({ body: '{}', routeParams: { id: '1' } }), { options: sampleOptions() })
  expect(response.status).toBe(422)
  expect(await response.json()).toMatchObject({ errors: [{ code: 'locked-placement', detail: { id: 2 } }] })
})

for (const row of cases) {
  test.each([
    ['number', '1', 1], ['number', '01', 1], ['text', '1', '1'],
    ['uuid', '8b5ac9a6-2cb0-4e75-9aca-387069d8a981', '8b5ac9a6-2cb0-4e75-9aca-387069d8a981'],
  ])(`${row.name}: route id follows %s id type`, async (defaultIDType, id, expected) => {
    const payload = fakePayload()
    Object.assign(payload.db, { defaultIDType })
    const req = fakeReq({ payload, routeParams: { id }, body: JSON.stringify(row.body) })
    const spy = vi.spyOn(row.module as typeof starts, row.name as 'start').mockResolvedValue({ doc: { id: expected }, revision: 1 } as Awaited<ReturnType<typeof starts.start>>)
    expect((await row.handler(req, { options: sampleOptions() })).status).toBe(200)
    expect(spy).toHaveBeenCalledWith(req, expect.objectContaining({ experimentId: expected }))
  })
  test(`${row.name}: a nonnumeric route id on a numeric host returns 404`, async () => {
    const payload = fakePayload()
    Object.assign(payload.db, { defaultIDType: 'number' })
    const spy = vi.spyOn(row.module as typeof starts, row.name as 'start')
    const response = await row.handler(fakeReq({ payload, routeParams: { id: 'abc' }, body: JSON.stringify(row.body) }), { options: sampleOptions() })
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ errors: [{ code: 'not-found' }] })
    expect(spy).not.toHaveBeenCalled()
  })
}
