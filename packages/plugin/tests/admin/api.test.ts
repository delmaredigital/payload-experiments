import { afterEach, beforeEach, expect, test, vi } from 'vitest'
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
  ['forbidden', 403, "You don't have permission to do this.", false],
  ['future-code', 422, 'Server explanation', false],
] as const)('maps %s', async (code, status, message, retryable) => {
  respond({ errors: [{ code, message: 'Server explanation' }] }, status)
  expect(await api.stop(1)).toEqual({ ok: false, status, code, message, retryable })
})
test('501 overrides the code', async () => {
  respond({ errors: [{ message: 'CORE-15' }] }, 501)
  expect(await api.results(1)).toEqual({ ok: false, status: 501, code: 'not-implemented', message: "This isn't available yet.", retryable: true })
})
test('HTTP statuses map even without a coded envelope', async () => {
  for (const [status, message] of [[404, 'This experiment no longer exists.'], [403, "You don't have permission to do this."]] as const) {
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
  for (const status of [200, 500, 501]) {
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
    [() => api.summary([]), '/summary?ids='],
  ] as const
  for (const [call, suffix] of cases) {
    respond({})
    await call()
    expect(fetchMock).toHaveBeenLastCalledWith(`/custom/api/xp/experiments${suffix}`, { method: 'GET', credentials: 'include' })
  }
})
