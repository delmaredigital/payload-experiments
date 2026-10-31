import { afterEach, expect, test, vi } from 'vitest'
import { requestState, newRequest } from './requestHarness.js'
import { assignments, experiment, manifest, page, runtime, secrets } from './helpers.js'
import { getAssignments } from '../../src/server/getAssignments.js'
import { encodeAssignmentsHeader } from '../../src/runtime/header.js'
import { signPreviewToken } from '../../src/runtime/previewToken.js'
import { resolveExperimentData } from '../../src/server/resolveExperimentData.js'
import { NextRequest } from 'next/server'
import * as requestReader from '../../src/server/request.js'
import { assign } from '../../src/runtime/assign.js'
import { toClientAssignments } from '../../src/server/toClientAssignments.js'

afterEach(() => vi.restoreAllMocks())
const header = (a = assignments(), m = manifest()) => requestState.headers.set('x-xp-assignments', encodeAssignmentsHeader(a, { secrets, manifest: m }))
// Explicit seam for future verified CORE-06c context; the default request has none.
const trustedContext = (path = '/', method = 'GET') => vi.spyOn(requestReader, 'serverRequest').mockImplementation(headers => ({ request: new NextRequest(`https://example.com${path}`, { headers, method }), hasContext: true }))

test('verified header is used but missing context keeps method unknown and non-exposable', async () => {
  const a = assignments(); a.userId = undefined; a.bySlug.hero!.arm = 'control'
  header(a)
  requestState.headers.set('x-invoke-method', 'HEAD')
  const result = await getAssignments(runtime().rt)
  expect(result.bySlug.hero).toMatchObject({ arm: 'control', source: 'header', exposable: false })
  expect(result.archivedWinners).toEqual({ archived: 'variantB' })
  expect(result.method).toBe('UNKNOWN')
})
test('tampered header falls back to non-exposable control without context', async () => {
  requestState.headers.set('x-xp-assignments', 'v1.3..hero=control.invalid')
  const result = await getAssignments(runtime().rt)
  expect(result.bySlug.hero).toMatchObject({ arm: 'control', exposable: false, source: 'fallback' })
})
test.each(['unsigned', 'missing'])('%s cookie gives control, non-exposable even for a known user', async mode => {
  requestState.cookie = mode === 'unsigned' ? 'visitor' : ''
  const m = manifest([experiment(), experiment({ id: 8, slug: 'user', unitType: 'user' })])
  const result = await getAssignments(runtime(m, { getUnit: () => ({ userId: 'user', attributes: {} }) }).rt)
  expect(Object.values(result.bySlug).every(a => a.arm === 'control' && !a.exposable)).toBe(true)
})
test('consent-false proxy request cannot expose even with a header and user', async () => {
  const a = assignments(); a.visitorId = undefined; a.userId = undefined
  for (const entry of Object.values(a.bySlug)) { entry.arm = 'control'; entry.exposable = false }
  header(a); requestState.cookie = ''
  const result = await getAssignments(runtime(undefined, {}, { getUser: async () => ({ id: 'user' }) }).rt)
  expect(result.bySlug.hero).toMatchObject({ arm: 'control', exposable: false })
})
test('newer header reloads manifest once then verifies against the new phase', async () => {
  const old = manifest(), next = { ...manifest([experiment({ phase: 2 })]), revision: 4 }
  const a = assignments(next); a.userId = undefined; header(a, next)
  const { rt, loadManifest } = runtime(old)
  loadManifest.mockResolvedValueOnce(old).mockResolvedValueOnce(next)
  const result = await getAssignments(rt)
  expect(result.bySlug.hero).toMatchObject({ phase: 2, source: 'header' })
  expect(loadManifest).toHaveBeenCalledTimes(2)
})
test('still-newer header reloads once; older header does not reload; both fail closed without context', async () => {
  for (const revision of [2, 4]) {
    newRequest()
    const m = { ...manifest(), revision }, a = assignments(m); a.userId = undefined; header(a, m)
    const { rt, loadManifest } = runtime()
    expect((await getAssignments(rt)).bySlug.hero).toMatchObject({ source: 'fallback', exposable: false })
    expect(loadManifest).toHaveBeenCalledTimes(revision === 4 ? 2 : 1)
  }
})
test('deferred slug resolves getUser/userIdOf and server attributes', async () => {
  trustedContext()
  const m = manifest([experiment({ unitType: 'user', deferrable: true, targeting: [{ attribute: 'loggedIn', op: 'eq', value: true, type: 'boolean' }] })])
  const a = assignments(m); a.userId = undefined; a.bySlug = {}; a.deferred = ['hero']; a.sessionUnknown = true; header(a, m)
  const getUser = vi.fn(async () => ({ id: 12 })), userIdOf = vi.fn(() => 'host-user')
  const result = await getAssignments(runtime(m, {}, { getUser, userIdOf }).rt)
  expect(getUser).toHaveBeenCalledTimes(1)
  expect(userIdOf).toHaveBeenCalledWith({ id: 12 })
  expect(result).toMatchObject({ userId: 'host-user', sessionUnknown: false, bySlug: { hero: { arm: 'variantA', exposable: true } } })
})
test('u with declared staff resolves user even without deferred slugs', async () => {
  const a = assignments(); a.userId = undefined; a.sessionUnknown = true; header(a)
  const getUser = vi.fn(async () => ({ id: 1 })), attributesOf = vi.fn(() => ({ staff: true }))
  const result = await getAssignments(runtime(undefined, {}, { getUser, attributesOf }, { attributeKeys: { staff: { type: 'boolean' } } }).rt)
  expect(getUser).toHaveBeenCalledTimes(1); expect(attributesOf).toHaveBeenCalledTimes(1)
  expect(result.staff).toBe(true)
  expect(Object.values(result.bySlug).every(a => !a.exposable)).toBe(true)
  expect(resolveExperimentData({ content: [], root: { props: {} } }, result).rendered).toEqual([])
})
test('u and declared staff without getUser suppresses all exposure', async () => {
  const m = manifest([experiment({ kind: 'flag', flagPoint: 'point' })]), a = assignments(m)
  a.userId = undefined; a.sessionUnknown = true; header(a, m)
  const result = await getAssignments(runtime(m, {}, {}, { attributeKeys: { staff: { type: 'boolean' } } }).rt)
  expect(result.bySlug.hero!.exposable).toBe(false)
  expect(result.flagPoints.point!.exposable).toBe(false)
})
test('request cache keys runtime and user id; one headers read and manifest load', async () => {
  const { rt, loadManifest } = runtime()
  const [a, b] = await Promise.all([getAssignments(rt, { user: { id: 1 } }), getAssignments(rt, { user: { id: 1 } })])
  expect(a).toBe(b); expect(loadManifest).toHaveBeenCalledTimes(1)
  expect(requestState.headersRead).toHaveBeenCalledTimes(1)
  const c = await getAssignments(rt, { user: { id: 2 } }); expect(c).not.toBe(a)
  newRequest(); expect(await getAssignments(rt, { user: { id: 1 } })).not.toBe(a)
})
test('draft preview forces arm with authenticated access checked Local API', async () => {
  const token = signPreviewToken({ e: 99, a: 'variantA', p: 0, exp: Math.floor(Date.now() / 1000) + 60 }, secrets)
  trustedContext(`/?xp_preview=${token}`)
  const { rt, payload } = runtime(undefined, {}, { getUser: async () => ({ id: 1 }) })
  vi.mocked(payload.findByID).mockResolvedValue({ id: 99, slug: 'draft', status: 'draft', phase: 0, exposurePolicy: 'render', arms: [{ key: 'variantA', kind: 'variant' }] })
  const result = await getAssignments(rt)
  expect(payload.findByID).toHaveBeenCalledWith(expect.objectContaining({ collection: 'xp-experiments', id: 99, overrideAccess: false, user: { id: 1 }, req: expect.objectContaining({ user: { id: 1 } }) }))
  expect(result.preview).toBe(true)
  expect(result.bySlug.draft).toMatchObject({ arm: 'variantA', exposable: false, source: 'preview' })
  expect(Object.values(result.bySlug).every(a => !a.exposable)).toBe(true)
})
test('absent/overflowed header on a page target is control non-exposable', async () => {
  requestState.headers.set('x-url', 'https://example.com/variant')
  expect((await getAssignments(runtime(manifest([page()])).rt)).bySlug.hero).toMatchObject({ arm: 'control', exposable: false })
})
test.each(['staff', 'bot', 'preview'] as const)('%s signed context suppresses every assignment and flag point', async flag => {
  const m = manifest([experiment({ kind: 'flag', flagPoint: 'point' })]), a = assignments(m)
  a.userId = undefined; a[flag] = true; header(a, m)
  const result = await getAssignments(runtime(m).rt)
  expect(result[flag]).toBe(true)
  expect(result.bySlug.hero!.exposable).toBe(false); expect(result.flagPoints.point!.exposable).toBe(false)
})
test('null manifest returns safe empty assignments', async () => {
  expect(await getAssignments(runtime(undefined, { loadManifest: async () => null }).rt)).toMatchObject({ revision: 0, bySlug: {}, flagPoints: {} })
})

test('unknown session stays deferred without a resolver, rather than becoming logged out', async () => {
  const m = manifest([experiment({ deferrable: true, targeting: [{ attribute: 'loggedIn', op: 'eq', value: false, type: 'boolean' }] })])
  const a = assignments(m); a.userId = undefined; a.bySlug = {}; a.deferred = ['hero']; a.sessionUnknown = true; header(a, m)
  const { rt } = runtime(m, { getUnit: () => ({ attributes: {}, sessionUnknown: true }) })
  const result = await getAssignments(rt)
  expect(result.sessionUnknown).toBe(true)
  expect(result.bySlug.hero).toMatchObject({ arm: 'control', exposable: false })
})
test('recompute never loses known proxy staff when server attributes say false', async () => {
  const { rt } = runtime(undefined, { getUnit: () => ({ attributes: { staff: true } }) }, { attributesOf: () => ({ staff: false }) })
  expect(await getAssignments(rt)).toMatchObject({ staff: true, bySlug: { hero: { exposable: false } } })
})
test.each(['failure', 'null'] as const)('forced refresh %s preserves last good manifest for later requests', async mode => {
  const next = { ...manifest(), revision: 4 }, a = assignments(next); a.userId = undefined; header(a, next)
  const { rt, loadManifest } = runtime()
  if (mode === 'failure') loadManifest.mockResolvedValueOnce(manifest()).mockRejectedValueOnce(new Error('offline'))
  else loadManifest.mockResolvedValueOnce(manifest()).mockImplementationOnce(async () => null as never)
  expect((await getAssignments(rt)).revision).toBe(3)
  newRequest()
  expect((await getAssignments(rt)).revision).toBe(3)
})
test('without guaranteed URL/method context, recompute and deferred entries fail closed', async () => {
  requestState.headers.delete('x-url'); requestState.headers.delete('x-invoke-method')
  expect((await getAssignments(runtime(manifest([page()])).rt)).bySlug.hero).toMatchObject({ arm: 'control', exposable: false })
  const a = assignments(); a.userId = undefined; a.bySlug = {}; a.deferred = ['hero']; header(a)
  expect((await getAssignments(runtime(undefined, {}, { getUser: async () => ({ id: 1 }) }).rt)).bySlug.hero).toMatchObject({ arm: 'control', exposable: false })
})
test('forced reload retains the latest normal refresh, never an older forced snapshot', async () => {
  vi.useFakeTimers()
  try {
    const m3 = manifest(), m4 = { ...manifest(), revision: 4 }, m5 = { ...manifest(), revision: 5 }
    const a4 = assignments(m4); a4.userId = undefined; header(a4, m4)
    const load = vi.fn().mockResolvedValueOnce(m3).mockResolvedValueOnce(m4).mockResolvedValueOnce(m5).mockRejectedValueOnce(new Error('offline'))
    const { rt } = runtime(m3, { loadManifest: load })
    expect((await getAssignments(rt)).revision).toBe(4)
    vi.advanceTimersByTime(30_001)
    newRequest(); await getAssignments(rt)
    await vi.advanceTimersByTimeAsync(0)
    newRequest(); expect((await getAssignments(rt)).revision).toBe(5)
    newRequest()
    const m6 = { ...manifest(), revision: 6 }, a6 = assignments(m6); a6.userId = undefined; header(a6, m6)
    expect((await getAssignments(rt)).revision).toBe(5)
    expect(load).toHaveBeenLastCalledWith({ ifRevision: 5 })
  } finally { vi.useRealTimers() }
})

test.each(['GET', 'TRACE'])('browser URL/method headers (%s) cannot change assignments or cause errors', async method => {
  const m = manifest([page({ deferrable: true, targeting: [{ attribute: 'loggedIn', op: 'eq', value: false, type: 'boolean' }] })])
  const a = assignments(m); a.userId = undefined; a.bySlug = {}; a.deferred = ['hero']; a.sessionUnknown = true
  const { rt, payload } = runtime(m, {}, { getUser: async () => null })
  header(a, m)
  const before = await getAssignments(rt)
  newRequest(); header(a, m)
  const token = signPreviewToken({ e: 99, a: 'variantA', p: 0, exp: Math.floor(Date.now() / 1000) + 60 }, secrets)
  for (const key of ['next-url', 'x-url', 'x-invoke-path']) requestState.headers.set(key, `/variant?xp_preview=${token}`)
  requestState.headers.set('x-invoke-method', method)
  requestState.headers.set('x-invoke-query', JSON.stringify({ xp_preview: token }))
  const after = await getAssignments(rt)
  expect(after).toStrictEqual(before)
  expect(after.method).toBe('UNKNOWN')
  expect(after.bySlug.hero).toMatchObject({ arm: 'control', exposable: false })
  expect(payload.findByID).not.toHaveBeenCalled()
  expect(toClientAssignments(after, { pathname: '/variant' }).pageviews).toStrictEqual([])
})
test('consent-false verified winners survive without either identity', async () => {
  const m = manifest([experiment({ kind: 'flag', flagPoint: 'point', status: 'decided', winnerArm: 'variantA', exposurePolicy: 'manual' })])
  const a = assignments(m); a.visitorId = undefined; a.userId = undefined
  a.bySlug.hero!.arm = 'variantA'; a.bySlug.hero!.exposable = false
  header(a, m); requestState.cookie = ''
  const result = await getAssignments(runtime(m, { getUnit: () => ({ userId: 'must-ignore', attributes: {} }) }, { getUser: async () => ({ id: 'also-ignore' }) }).rt)
  expect(result).toMatchObject({ visitorId: undefined, userId: undefined, bySlug: { hero: { arm: 'variantA', source: 'header', exposable: false } }, flagPoints: { point: { arm: 'variantA', exposable: false } } })
})
test.each([false, true])('resolved user mismatch recomputes every user-unit arm (trusted context %s)', async trusted => {
  if (trusted) trustedContext()
  const m = manifest([experiment({ unitType: 'user', kind: 'flag', flagPoint: 'point', exposurePolicy: 'manual', arms: [
    { key: 'control', kind: 'control', weight: 50, params: { text: 'original' } },
    { key: 'variantA', kind: 'variant', weight: 50, params: { text: 'winner' } },
  ] })])
  const old = assign(m, { visitorId: 'visitor', userId: 'old' }, {}, { now: 1 })
  let newId = ''
  for (let i = 0; i < 100; i++) {
    const id = `new-${i}`
    if (assign(m, { visitorId: 'visitor', userId: id }, {}, { now: 1 }).bySlug.hero!.arm !== old.bySlug.hero!.arm) { newId = id; break }
  }
  expect(newId).not.toBe('')
  header(old, m)
  const { rt } = runtime(m, { getUnit: () => ({ userId: 'old', attributes: {} }) })
  const result = await getAssignments(rt, { user: { id: newId } })
  const expected = assign(m, { visitorId: 'visitor', userId: newId }, {}, { now: 1 }).bySlug.hero!
  expect(result.userId).toBe(newId)
  expect(result.bySlug.hero).toMatchObject({ arm: expected.arm, source: 'recomputed', exposable: trusted })
  expect(result.flagPoints.point).toMatchObject({ arm: expected.arm, exposable: trusted })
})
test('unsigned or tampered newer revisions never force a manifest reload', async () => {
  for (const value of ['v1.999999..hero=variantA.bogus', 'v1.999999..hero=variantA.' + 'a'.repeat(43)]) {
    newRequest(); requestState.headers.set('x-xp-assignments', value)
    const { rt, loadManifest } = runtime()
    await getAssignments(rt)
    expect(loadManifest).toHaveBeenCalledTimes(1)
  }
})
test('cold newer header spends only one coldStartMs window', async () => {
  vi.useFakeTimers()
  try {
    const m = { ...manifest(), revision: 4 }, a = assignments(m); a.userId = undefined; header(a, m)
    const load = vi.fn(() => new Promise<never>(() => {})), { rt } = runtime(undefined, { loadManifest: load })
    let settled = false
    const pending = getAssignments(rt).then(result => { settled = true; return result })
    await vi.advanceTimersByTimeAsync(1499); expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1); expect(settled).toBe(true)
    expect(await pending).toMatchObject({ revision: 0, bySlug: {} })
    expect(load).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(5000)
  } finally { vi.useRealTimers() }
})
test('getPayload failure is logged and degrades a valid variant header to control', async () => {
  const a = assignments(); a.userId = undefined; header(a)
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  const { rt } = runtime(undefined, {}, { getPayload: async () => { throw new Error('unavailable') } })
  expect(await getAssignments(rt)).toMatchObject({ bySlug: { hero: { arm: 'control', exposable: false, source: 'fallback' } } })
  expect(log).toHaveBeenCalledTimes(1)
})
