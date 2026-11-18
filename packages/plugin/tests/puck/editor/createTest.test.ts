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

test('default block names preserve punctuation and read all duplicate-name pages before picking a number', async () => {
  const { createBlockTest } = await import('../../../src/puck/editor/createTest.js')
  const fetcher = vi.fn(async (input: string, init?: RequestInit) => {
    if (init?.method === 'POST') return response({ doc: { id: 'created', slug: 'news-events-test-3' } })
    const url = new URL(input, 'https://example.test')
    if (url.searchParams.has('where[name][like]')) {
      expect(url.searchParams.get('where[name][like]')).toBe('News, Events test')
      expect(url.searchParams.get('limit')).toBe('100')
      expect(url.searchParams.has('where[name][in]')).toBe(false)
      return response(url.searchParams.get('page') === '1' ? {
        docs: Array.from({ length: 100 }, (_, id) => ({ id, name: 'News, Events test' })), hasNextPage: true,
      } : { docs: [{ id: 'last', name: 'News, Events test 2' }], hasNextPage: false })
    }
    return response({ docs: [] })
  })
  vi.stubGlobal('fetch', fetcher)
  await createBlockTest('/api', 'News, Events', [])
  const post = fetcher.mock.calls.find(([, init]) => init?.method === 'POST')!
  expect(JSON.parse(String(post[1]!.body)).name).toBe('News, Events test 3')
  expect(fetcher).toHaveBeenCalledTimes(4)
})


test.each([0, 1, 137])('long block title uses short lookup URLs with %s existing names', async count => {
  const { createBlockTest } = await import('../../../src/puck/editor/createTest.js')
  const title = 'A long page title '.repeat(10)
  const base = `${title.trim()} test`
  const existing = Array.from({ length: count }, (_, index) => ({ id: index, name: index === 0 ? base : `${base} ${index + 1}` }))
  const fetcher = vi.fn(async (input: string, init?: RequestInit) => {
    expect(input.length).toBeLessThan(2000)
    if (init?.method === 'POST') return response({ doc: { id: 1, slug: 'created' } })
    const params = new URL(input, 'https://example.test').searchParams
    if (!params.has('where[name][like]')) return response({ docs: [] })
    const page = Number(params.get('page'))
    return response({ docs: existing.slice((page - 1) * 100, page * 100), hasNextPage: count > page * 100 })
  })
  vi.stubGlobal('fetch', fetcher)
  await createBlockTest('/api', title, [])
  const post = fetcher.mock.calls.find(([, init]) => init?.method === 'POST')!
  expect(JSON.parse(String(post[1]!.body)).name).toBe(count ? `${base} ${count + 1}` : base)
})

test.each([false, true])('block names retain their suffix at the Payload text limit (occupied: %s)', async occupied => {
  const { createBlockTest } = await import('../../../src/puck/editor/createTest.js')
  const title = 'x'.repeat(40_000)
  const base = `${'x'.repeat(39_995)} test`
  const fetcher = vi.fn(async (input: string, init?: RequestInit) => {
    expect(input.length).toBeLessThan(2000)
    if (init?.method === 'POST') return response({ doc: { id: 1, slug: 'created' } })
    return response({ docs: input.includes('name') && occupied ? [{ name: base }] : [] })
  })
  vi.stubGlobal('fetch', fetcher)
  await createBlockTest('/api', title, [])
  const post = fetcher.mock.calls.find(([, init]) => init?.method === 'POST')!
  const name = JSON.parse(String(post[1]!.body)).name
  expect(name).toHaveLength(40_000)
  expect(name).toBe(occupied ? `${'x'.repeat(39_993)} test 2` : base)
})

test('empty page titles use the copy module fallback', async () => {
  const { createBlockTest } = await import('../../../src/puck/editor/createTest.js')
  const fetcher = vi.fn(async (_input: string, init?: RequestInit) => response(init?.method === 'POST' ? { doc: { id: 1, slug: 'page-test' } } : { docs: [] }))
  vi.stubGlobal('fetch', fetcher)
  await createBlockTest('/api', '  ', [])
  expect(JSON.parse(String(fetcher.mock.calls.find(([, init]) => init?.method === 'POST')![1]!.body)).name).toBe('Page test')
})
