import { expect, test } from 'vitest'
import { handleSummary } from '../../src/endpoints/summary.js'
import { fakePayload } from '../_fakes/payload.js'
import { fakeReq } from '../_fakes/req.js'
import { sampleOptions } from '../collections/fixtures.js'
import fixture from '../_fixtures/snapshots/T7.json'
const options = sampleOptions()

test('latest snapshot summaries preserve opaque encoded ids and return null verdict before first run', async () => {
  const id = 'opaque, /%+é'
  const payload = fakePayload({ collections: { 'xp-results-snapshots': [
    { id: 1, experiment: id, phase: 1, computedAt: '2026-10-01T00:00:00Z', snapshot: { ...fixture, exposures: { total: 1 } } },
    { id: 2, experiment: id, phase: 1, computedAt: '2026-10-02T00:00:00Z', snapshot: fixture },
  ] } })
  const req = fakeReq({ payload, url: `http://localhost/summary?ids=${encodeURIComponent(id)},draft,__proto__` })
  const response = await handleSummary(req, { options })
  const body = await response.json()
  expect(body[id]).toEqual({ exposures: fixture.exposures.total,
    days: (Date.parse(fixture.window.to) - Date.parse(fixture.window.from)) / 86_400_000,
    verdict: { code: fixture.verdict.code, headline: fixture.verdict.headline } })
  expect(body.draft).toEqual({ exposures: 0, days: 0, verdict: null })
  expect(Object.hasOwn(body, '__proto__')).toBe(true)
  expect(payload.calls[0]!.args).toMatchObject({ req, overrideAccess: false, depth: 0 })
})

test.each([
  ['', 400, 'invalid-body'], ['?ids=%E0%A4', 400, 'invalid-body'], ['?ids=', 422, 'invalid-ids'],
  [`?ids=${Array.from({ length: 101 }, (_, n) => n).join(',')}`, 422, 'too-many-ids'],
])('summary refuses %s with distinct parse/input codes', async (query, status, code) => {
  const req = fakeReq({ url: `http://localhost/summary${query}` })
  const response = await handleSummary(req, { options })
  expect(response.status).toBe(status)
  expect(await response.json()).toMatchObject({ errors: [{ code }] })
})

test('100 ids accepted, repeated ids deduplicated in the reader', async () => {
  const payload = fakePayload()
  expect((await handleSummary(fakeReq({ payload, url: `http://localhost/summary?ids=${Array(100).fill('one').join(',')}` }), { options })).status).toBe(200)
  expect(payload.calls[0]!.args.where).toEqual({ experiment: { in: ['one'] } })
})
