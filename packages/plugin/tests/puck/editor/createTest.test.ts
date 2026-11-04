import { afterEach, expect, test, vi } from 'vitest'
import { resolvePuckRoutes } from '../../../src/puck/routes.js'
import { CreateRefused, createTest } from '../../../src/puck/editor/createTest.js'

afterEach(() => vi.unstubAllGlobals())
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const collision = { errors: [{ data: { errors: [{ path: 'slug', message: 'Value must be unique' }] }, message: 'Already used' }] }
const input = { kind: 'flag', name: 'Welcome', unitType: 'visitor', flagPoint: 'welcome' } as const

test('a racing slug collision resumes at the next candidate and retries exactly once', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(response({ docs: [] })).mockResolvedValueOnce(response(collision, 400))
    .mockResolvedValueOnce(response({ docs: [{ slug: 'welcome' }] })).mockResolvedValueOnce(response({ doc: { id: 12, slug: 'welcome-2' } }))
  vi.stubGlobal('fetch', fetch)
  expect(await createTest(resolvePuckRoutes({ api: '/data/' }).api, input)).toEqual({ id: 12, slug: 'welcome-2' })
  expect(fetch).toHaveBeenCalledTimes(4)
  const params = (index: number) => new URL(fetch.mock.calls[index]![0], 'https://example.test').searchParams
  expect(params(0).get('where[slug][in]')?.split(',')[0]).toBe('welcome')
  expect(params(2).get('where[slug][in]')?.split(',')[0]).toBe('welcome-2')
  expect(JSON.parse(fetch.mock.calls[3]![1].body).slug).toBe('welcome-2')
})
test('a second collision and ordinary refusals never trigger another retry', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(response({ docs: [] })).mockResolvedValueOnce(response(collision, 400))
    .mockResolvedValueOnce(response({ docs: [{ slug: 'welcome' }] })).mockResolvedValueOnce(response(collision, 400))
  vi.stubGlobal('fetch', fetch)
  await expect(createTest('/api', input)).rejects.toThrow('This name is too close to an existing test. Choose a different name.')
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


test.each([
  [{ errors: [{ message: 'The following field is invalid: flagPoint', data: { errors: [{ message: 'Choose another setting.' }] } }] }, 'Choose another setting.'],
  [{ errors: [{ message: 'The following field is invalid: flagPoint' }] }, "Couldn't create the test. Try again."],
  [{ errors: [{ data: { errors: [{ message: '' }] } }] }, "Couldn't create the test. Try again."],
])('server refusals use only the inner field message or the generic message', async (body, message) => {
  const fetch = vi.fn().mockResolvedValueOnce(response({ docs: [] })).mockResolvedValueOnce(response(body, 400))
  vi.stubGlobal('fetch', fetch)
  const error = await createTest('/api', input).catch(cause => cause)
  expect(error).toBeInstanceOf(CreateRefused)
  expect(error.message).toBe(message)
  expect(fetch).toHaveBeenCalledTimes(2)
})

test.each(['lookup', 'create'])('transport and JSON failures in %s are never server refusals', async stage => {
  for (const failure of ['network', 'json']) {
    const fetch = vi.fn()
    if (stage === 'create') fetch.mockResolvedValueOnce(response({ docs: [] }))
    if (failure === 'network') fetch.mockRejectedValueOnce(new Error('offline'))
    else fetch.mockResolvedValueOnce(new Response('<html>Bad gateway</html>', { status: 502 }))
    vi.stubGlobal('fetch', fetch)
    const error = await createTest('/api', input).catch(cause => cause)
    expect(error).toBeInstanceOf(Error)
    expect(error).not.toBeInstanceOf(CreateRefused)
    expect(fetch).toHaveBeenCalledTimes(stage === 'create' ? 2 : 1)
  }
})

test('250 occupied names need exactly six bounded in probes and one successful POST', async () => {
  const existing = new Set(Array.from({ length: 250 }, (_, index) => index === 0 ? 'base' : `base-${index + 1}`))
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      const slug = JSON.parse(init.body as string).slug
      expect(slug).toBe('base-251')
      return response({ doc: { id: 251, slug } })
    }
    const params = new URL(url, 'https://example.test').searchParams
    const candidates = params.get('where[slug][in]')!.split(',')
    return response({ docs: candidates.filter(slug => existing.has(slug)).map(slug => ({ slug })) })
  })
  vi.stubGlobal('fetch', fetch)
  expect(await createTest('/api', { ...input, name: 'Base' })).toEqual({ id: 251, slug: 'base-251' })
  expect(fetch).toHaveBeenCalledTimes(7)
  for (let batch = 0; batch < 6; batch++) {
    const url = new URL(fetch.mock.calls[batch]![0], 'https://example.test')
    expect(url.pathname).toBe('/api/xp-experiments')
    const candidates = Array.from({ length: 50 }, (_, offset) => {
      const index = batch * 50 + offset + 1
      return index === 1 ? 'base' : `base-${index}`
    })
    expect(Object.fromEntries(url.searchParams)).toEqual({ 'where[slug][in]': candidates.join(','), limit: '50', depth: '0', 'select[slug]': 'true' })
    expect(fetch.mock.calls[batch]![1]).toEqual({ credentials: 'include' })
  }
  expect(fetch.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
})
