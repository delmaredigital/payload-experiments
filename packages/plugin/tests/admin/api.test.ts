import { afterEach, beforeEach, expect, expectTypeOf, test, vi } from 'vitest'
import { createApi } from '../../src/admin/api.js'
import type { ErrorEnvelope } from '../../src/types/endpoints.js'

const fetchMock = vi.fn<typeof fetch>()
const api = createApi('/custom/api/')
beforeEach(() => vi.stubGlobal('fetch', fetchMock))
afterEach(() => { vi.unstubAllGlobals(); fetchMock.mockReset() })
function respond(body: unknown, status = 200) { fetchMock.mockResolvedValueOnce(Response.json(body, { status })) }

test('success is typed data', async () => {
  const data = { doc: { id: 1 }, revision: 3 }
  respond(data)
  expect(await api.start(1)).toEqual({ ok: true, data })
})
test('the first core refusal supplies the code and message', async () => {
  respond({ errors: [{ code: 'invalid-status', message: 'Stop the test first.' }, { code: 'forbidden', message: 'Ignored' }] } satisfies ErrorEnvelope, 409)
  expect(await api.start(1)).toEqual({ ok: false, status: 409, code: 'invalid-status', message: 'Stop the test first.', retryable: false })
})
test('Payload lock errors may omit a code', async () => {
  respond({ errors: [{ message: 'This field is locked.' }] }, 400)
  expect(await api.start(1)).toEqual({ ok: false, status: 400, message: 'This field is locked.', retryable: false })
})
test.each([
  ['not-found', 404, 'This experiment no longer exists.', false],
  ['commit-unverified', 500, 'The change may not have been saved. Reload and try again.', true],
  ['not-implemented', 422, "This isn't available yet.", false],
  ['unauthenticated', 422, 'Your session has expired. Sign in again.', false],
  ['forbidden', 403, "You don't have permission to do this.", false],
  ['future-code', 422, 'Server explanation', false],
] as const)('maps %s', async (code, status, message, retryable) => {
  respond({ errors: [{ code, message: 'Server explanation' }] }, status)
  expect(await api.stop(1)).toEqual({ ok: false, status, code, message, retryable })
})
test('501 overrides the code', async () => {
  respond({ errors: [{ message: 'CORE-15' }] }, 501)
  expect(await api.results(1)).toEqual({ ok: false, status: 501, code: 'not-implemented', message: "This isn't available yet.", retryable: false })
})
test('HTTP statuses map even without a coded envelope', async () => {
  for (const [status, message] of [[401, 'Your session has expired. Sign in again.'], [404, 'This experiment no longer exists.'], [403, "You don't have permission to do this."]] as const) {
    respond({}, status)
    expect(await api.start(1)).toMatchObject({ ok: false, status, message })
  }
})
test('network failure resolves, never rejects', async () => {
  fetchMock.mockRejectedValueOnce(new Error('offline'))
  await expect(api.start(1)).resolves.toEqual({ ok: false, status: 0,
    message: "Couldn't reach the server. Check your connection and try again.", retryable: true })
})
test('malformed JSON and malformed error bodies never reject', async () => {
  for (const status of [500, 501]) {
    fetchMock.mockResolvedValueOnce(new Response('not json', { status }))
    const result = await api.results(1)
    expect(result.ok).toBe(false)
    if (!result.ok) { expect(result.status).toBe(status); expect(result.message).toBeTruthy() }
  }
  for (const body of [null, {}, { errors: [] }, { errors: [null] }, { errors: 'bad' }]) {
    respond(body, 422)
    await expect(api.start(1)).resolves.toMatchObject({ ok: false, status: 422, retryable: false })
  }
})
const endpoints = [
  ['start', () => api.start('id /?'), undefined],
  ['allocate', () => api.allocate('id /?', { allocation: 75 }), { allocation: 75 }],
  ['add-metric', () => api.addMetric('id /?', { metric: 2, role: 'guardrail' }), { metric: 2, role: 'guardrail' }],
  ['stop', () => api.stop('id /?'), undefined],
  ['decide', () => api.decide('id /?', { winnerArm: 'variantA', note: 'Ship', confirmation: 'Variant A' }), { winnerArm: 'variantA', note: 'Ship', confirmation: 'Variant A' }],
  ['release-holdout', () => api.releaseHoldout('id /?'), undefined],
  ['release-pages', () => api.releasePages('id /?'), undefined],
  ['make-content', () => api.makeContent('id /?'), undefined],
  ['archive', () => api.archive('id /?', { mode: 'discard', confirmation: 'discard winner' }), { mode: 'discard', confirmation: 'discard winner' }],
  ['recompute', () => api.recompute('id /?'), undefined],
] as const
for (const [action, call, body] of endpoints) test(`${action}: POST URL and body`, async () => {
  respond({})
  await call()
  expect(fetchMock).toHaveBeenCalledExactlyOnceWith(`/custom/api/xp/experiments/id%20%2F%3F/${action}`, {
    method: 'POST', credentials: 'include', ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
  })
})
test('GET endpoint URLs, query and credentials', async () => {
  const cases = [
    [() => api.preflight(1), '/1/preflight'],
    [() => api.previewToken(1, 'variant &A'), '/1/preview-token?arm=variant%20%26A'],
    [() => api.results(1), '/1/results'],
    [() => api.results(1, { phase: 2, series: true }), '/1/results?phase=2&series=1'],
    [() => api.results(1, { phase: 0, series: false }), '/1/results?phase=0'],
    [() => api.summary([1, 'id &x']), '/summary?ids=1,id%20%26x'],
    
  ] as const
  for (const [call, suffix] of cases) {
    respond({})
    await call()
    expect(fetchMock).toHaveBeenLastCalledWith(`/custom/api/xp/experiments${suffix}`, { method: 'GET', credentials: 'include' })
  }
})

test.each([
  [200, ''], [200, 'not json'], [204, null],
] as const)('successful %s with body %s resolves with undefined data', async (status, body) => {
  fetchMock.mockResolvedValueOnce(new Response(body, { status }))
  await expect(api.recompute(1)).resolves.toEqual({ ok: true, data: undefined })
})
test('a non-JSON 501 cannot be retried', async () => {
  fetchMock.mockResolvedValueOnce(new Response('not implemented', { status: 501 }))
  await expect(api.start(1)).resolves.toMatchObject({ ok: false, retryable: false, message: "This isn't available yet." })
})
test('recompute returns a typed snapshot id', async () => {
  respond({ snapshotId: 'snapshot-1' })
  const result = await api.recompute(1)
  if (!result.ok) throw new Error(result.message)
  expectTypeOf(result.data).toEqualTypeOf<{ snapshotId: string } | undefined>()
  expect(result.data?.snapshotId).toBe('snapshot-1')
})
test('results query works without URLSearchParams.size', async () => {
  const query = new URLSearchParams()
  Object.defineProperty(query, 'size', { get() { throw new Error('size is unavailable') } })
  const constructor = vi.spyOn(globalThis, 'URLSearchParams').mockImplementation(function () { return query })
  try {
    respond({})
    await api.results(1, { phase: 2, series: true })
    expect(fetchMock).toHaveBeenCalledWith('/custom/api/xp/experiments/1/results?phase=2&series=1', { method: 'GET', credentials: 'include' })
  } finally { constructor.mockRestore() }
})
test('empty summary resolves without a request', async () => {
  await expect(api.summary([])).resolves.toEqual({ ok: true, data: {} })
  expect(fetchMock).not.toHaveBeenCalled()
})
test('summary encodes each id before joining with comma separators', async () => {
  respond({})
  await api.summary(['id &x', 'id /?'])
  expect(fetchMock).toHaveBeenCalledWith('/custom/api/xp/experiments/summary?ids=id%20%26x,id%20%2F%3F', { method: 'GET', credentials: 'include' })
})
test('summary batches at 100 ids and merges every result', async () => {
  const ids = Array.from({ length: 201 }, (_, index) => String(index))
  const data = Object.fromEntries(ids.map(id => [id, { exposures: Number(id), days: 1, verdict: null }]))
  for (let offset = 0; offset < ids.length; offset += 100) {
    respond(Object.fromEntries(ids.slice(offset, offset + 100).map(id => [id, data[id]])))
  }
  await expect(api.summary(ids)).resolves.toEqual({ ok: true, data })
  expect(fetchMock).toHaveBeenCalledTimes(3)
  for (let index = 0; index < 3; index++) {
    expect(fetchMock).toHaveBeenNthCalledWith(index + 1, `/custom/api/xp/experiments/summary?ids=${ids.slice(index * 100, (index + 1) * 100).join(',')}`, { method: 'GET', credentials: 'include' })
  }
})
test('summary returns a failed batch rather than partial success', async () => {
  respond({})
  respond({ errors: [{ code: 'forbidden', message: 'Denied' }] }, 403)
  await expect(api.summary(Array.from({ length: 101 }, (_, index) => index)))
    .resolves.toMatchObject({ ok: false, status: 403 })
})
