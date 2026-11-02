import { afterEach, expect, test, vi } from 'vitest'
import { createTest } from '../../../../src/admin/surface/newTest/createTest.js'

afterEach(() => vi.unstubAllGlobals())
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const collision = { errors: [{ data: { errors: [{ path: 'slug', message: 'Value must be unique' }] }, message: 'Already used' }] }
const input = { kind: 'flag', name: 'Welcome', unitType: 'visitor', flagPoint: 'welcome' } as const

test('a racing slug collision re-queries and retries exactly once', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(response({ docs: [] })).mockResolvedValueOnce(response(collision, 400))
    .mockResolvedValueOnce(response({ docs: [{ slug: 'welcome' }] })).mockResolvedValueOnce(response({ doc: { id: 12 } }))
  vi.stubGlobal('fetch', fetch)
  expect(await createTest('/data/', input)).toBe(12)
  expect(fetch).toHaveBeenCalledTimes(4)
  expect(fetch.mock.calls[0]![0]).toBe('/data/xp-experiments?where[slug][like]=welcome&depth=0&limit=200&select[slug]=true')
  expect(fetch.mock.calls[2]![0]).toBe(fetch.mock.calls[0]![0])
  expect(JSON.parse(fetch.mock.calls[3]![1].body).slug).toBe('welcome-2')
})
test('a second collision and ordinary refusals never trigger another retry', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(response({ docs: [] })).mockResolvedValueOnce(response(collision, 400))
    .mockResolvedValueOnce(response({ docs: [{ slug: 'welcome' }] })).mockResolvedValueOnce(response(collision, 400))
  vi.stubGlobal('fetch', fetch)
  await expect(createTest('/api', input)).rejects.toThrow('Already used')
  expect(fetch).toHaveBeenCalledTimes(4)
})
test.each([{}, { doc: {} }])('malformed responses cannot navigate to an absent id', async body => {
  const fetch = vi.fn().mockResolvedValueOnce(response({ docs: [] })).mockResolvedValueOnce(response(body))
  vi.stubGlobal('fetch', fetch)
  await expect(createTest('/api', input)).rejects.toThrow("Couldn't create the test.")
})
test('a refused lookup never posts', async () => {
  const fetch = vi.fn().mockResolvedValue(response({}, 403))
  vi.stubGlobal('fetch', fetch)
  await expect(createTest('/api', input)).rejects.toThrow("Couldn't create the test.")
  expect(fetch).toHaveBeenCalledOnce()
})
