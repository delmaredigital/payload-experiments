import { afterEach, expect, test, vi } from 'vitest'
import { routeId } from '../../src/endpoints/routeId.js'
import { handlePreflight } from '../../src/endpoints/preflight.js'
import { handleResults } from '../../src/endpoints/results.js'
import { handlePreviewToken } from '../../src/endpoints/previewToken.js'
import { handleRecompute } from '../../src/endpoints/recompute.js'
import { preflightData } from '../../src/transitions/preflightData.js'
import { resultsMetadata, newestSnapshotIds } from '../../src/db/snapshots.js'
import { fakePayload } from '../_fakes/payload.js'
import { fakeReq } from '../_fakes/req.js'
import { sampleOptions } from '../collections/fixtures.js'

vi.mock('../../src/transitions/preflightData.js', async original => ({ ...await original<object>(), preflightData: vi.fn() }))
vi.mock('../../src/db/snapshots.js', async original => ({ ...await original<object>(), resultsMetadata: vi.fn(), newestSnapshotIds: vi.fn() }))
afterEach(() => vi.resetAllMocks())

const types = [
  { defaultIDType: 'number', customIDType: undefined, expected: 1 },
  { defaultIDType: 'text', customIDType: undefined, expected: '1' },
  { defaultIDType: 'uuid', customIDType: undefined, expected: '1' },
  { defaultIDType: 'number', customIDType: 'text', expected: '1' },
  { defaultIDType: 'text', customIDType: 'number', expected: 1 },
]
for (const { defaultIDType, customIDType, expected } of types) {
  test(`every reader uses the collection id type (default=${defaultIDType}, custom=${customIDType})`, async () => {
    const payload = fakePayload()
    Object.assign(payload.db, { defaultIDType })
    Object.assign(payload, { collections: { 'xp-experiments': { customIDType } } })
    const req = fakeReq({ payload, routeParams: { id: '1' } })
    const ctx = { options: sampleOptions() }
    expect(routeId(req)).toBe(expected)
    vi.mocked(preflightData).mockResolvedValue(null)
    expect((await handlePreflight(req, ctx)).status).toBe(404)
    expect(preflightData).toHaveBeenCalledWith(req, { experimentId: expected, options: ctx.options }, undefined)
    vi.mocked(resultsMetadata).mockResolvedValue({ status: 'draft', snapshotId: null, winnerArm: null })
    vi.mocked(newestSnapshotIds).mockResolvedValue([])
    expect((await handleResults(req, ctx)).status).toBe(200)
    expect(resultsMetadata).toHaveBeenCalledWith(expect.anything(), expected)
    expect(newestSnapshotIds).toHaveBeenCalledWith(expect.anything(), [expected], 'phase')
    for (const handler of [handlePreviewToken, handleRecompute]) {
      expect((await handler(req, ctx)).status).toBe(404)
      expect(payload.calls.at(-1)?.args).toMatchObject({ where: { id: { equals: expected } } })
    }
  })
}

test.each(['abc', '-1', '1.2', '1e2', ' 1', 'Infinity', '9007199254740992'])('numeric ids refuse %j before any reader runs', async id => {
  const payload = fakePayload()
  Object.assign(payload.db, { defaultIDType: 'number' })
  const req = fakeReq({ payload, routeParams: { id } })
  for (const handler of [handlePreflight, handleResults, handlePreviewToken, handleRecompute]) {
    const response = await handler(req, { options: sampleOptions() })
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ errors: [{ code: 'not-found' }] })
  }
  expect(payload.calls).toEqual([])
  expect(preflightData).not.toHaveBeenCalled()
  expect(resultsMetadata).not.toHaveBeenCalled()
})

test('text ids remain opaque and numeric ids permit leading zeroes', () => {
  const payload = fakePayload()
  Object.assign(payload.db, { defaultIDType: 'number' })
  expect(routeId(fakeReq({ payload, routeParams: { id: '01' } }))).toBe(1)
  expect(routeId(fakeReq({ payload }))).toBeUndefined()
  Object.assign(payload.db, { defaultIDType: 'text' })
  const id = '8b5ac9a6-2cb0-4e75-9aca-387069d8a981'
  expect(routeId(fakeReq({ payload, routeParams: { id } }))).toBe(id)
})
