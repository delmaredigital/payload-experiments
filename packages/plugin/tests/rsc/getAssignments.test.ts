import { afterEach, expect, test, vi } from 'vitest'
import { requestState, newRequest, trustedContext } from './requestHarness.js'
import { assignments, experiment, manifest, page, runtime, secrets } from './helpers.js'
import { getAssignments } from '../../src/server/getAssignments.js'
import { encodeUnitCookie } from '../../src/runtime/cookie.js'
import { encodeAssignmentsHeader } from '../../src/runtime/header.js'
import { signPreviewToken } from '../../src/runtime/previewToken.js'
import { resolveExperimentData } from '../../src/server/resolveExperimentData.js'
import { assign } from '../../src/runtime/assign.js'
import { NextRequest } from 'next/server.js'
import { resolveExperiments } from '../../src/proxy/resolve.js'
import type { ManifestExperiment } from '../../src/types/manifest.js'
import { sign } from '../../src/runtime/signing.js'
import { serverRequest } from '../../src/server/request.js'
import { toClientAssignments } from '../../src/server/toClientAssignments.js'
import { getFlagPoint } from '../../src/server/getFlagPoint.js'

afterEach(() => vi.restoreAllMocks())
const header = (a = assignments(), m = manifest()) => requestState.headers.set('x-xp-assignments', encodeAssignmentsHeader(a, { secrets, manifest: m }))

test('duplicate signed cookies authenticate the header bound to the last visitor', async () => {
  trustedContext()
  requestState.headers.set('cookie', `xp_id=${encodeUnitCookie('first', secrets)}; xp_id=${encodeUnitCookie('last', secrets)}`)
  const a = assignments(); a.visitorId = 'last'; a.userId = undefined
  header(a)
  const result = await getAssignments(runtime().rt)
  expect(result).toMatchObject({ visitorId: 'last', bySlug: { hero: { source: 'header', exposable: true } } })
})

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
  requestState.headers.set('cookie', mode === 'unsigned' ? 'xp_id=visitor' : '')
  const m = manifest([experiment(), experiment({ id: 8, slug: 'user', unitType: 'user' })])
  const result = await getAssignments(runtime(m, { getUnit: () => ({ userId: 'user', attributes: {} }) }).rt)
  expect(Object.values(result.bySlug).every(a => a.arm === 'control' && !a.exposable)).toBe(true)
})
test('consent-false proxy request cannot expose even with a header and user', async () => {
  const a = assignments(); a.visitorId = undefined; a.userId = undefined
  for (const entry of Object.values(a.bySlug)) { entry.arm = 'control'; entry.exposable = false }
  header(a); requestState.headers.delete('cookie')
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
  header(a, m); requestState.headers.delete('cookie')
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
test('resolved user mismatch recomputes exposable too: header exposable, signed-out user → non-exposable', async () => {
  trustedContext()
  const m = manifest([experiment({ unitType: 'user', kind: 'flag', flagPoint: 'point', exposurePolicy: 'manual', arms: [
    { key: 'control', kind: 'control', weight: 50, params: { text: 'original' } },
    { key: 'variantA', kind: 'variant', weight: 50, params: { text: 'winner' } },
  ] })])
  const old = assign(m, { visitorId: 'visitor', userId: 'old' }, {}, { now: 1 })
  expect(old.bySlug.hero!.exposable).toBe(true)
  header(old, m)
  const { rt } = runtime(m, { getUnit: () => ({ userId: 'old', attributes: {} }) })
  const result = await getAssignments(rt, { user: null })
  expect(result.bySlug.hero).toMatchObject({ arm: 'control', exposable: false })
  expect(result.flagPoints.point).toMatchObject({ exposable: false })
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


test.each(['/courses/x', '/courses/x/'])('signed GET recomputes an exposable page with normalised path %s', async path => {
  trustedContext(`${path}?q=1`)
  const m = manifest([page({ targeting: [{ attribute: 'path', op: 'eq', value: '/courses/x', type: 'string' }], arms: [
    { key: 'control', kind: 'control', weight: 0, pageTarget: '/courses/x/' },
    { key: 'variantA', kind: 'variant', weight: 100, pageTarget: '/winner/' },
  ] })])
  const result = await getAssignments(runtime(m, { getUnit: () => ({ attributes: { path: '/spoof' } }) }, {
    getUser: async () => null, attributesOf: () => ({ path: '/also-spoof' }),
  }).rt)
  expect(result).toMatchObject({ method: 'GET', bySlug: { hero: { arm: 'variantA', source: 'recomputed', exposable: true } } })
  expect(toClientAssignments(result, { pathname: '/winner' }).pageviews).toEqual([{ slug: 'hero', arm: 'variantA', phase: 1 }])
})
test.each(['HEAD', 'TRACE', 'CONNECT', '', 'not a verb'])('signed method %s never throws and cannot expose', async method => {
  trustedContext('/original', method)
  const result = await getAssignments(runtime(manifest([page()])).rt)
  expect(result.method).toBe(method === 'HEAD' ? 'HEAD' : 'UNKNOWN')
  expect(result.bySlug.hero!.exposable).toBe(false)
  expect(serverRequest(requestState.headers, secrets).hasContext).toBe(true)
})
test.each(['tampered path', 'tampered consent', 'unsigned', 'oversized', 'wrong domain'])('invalid request context (%s) fails closed', async mode => {
  trustedContext('/original')
  const signed = requestState.headers.get('x-xp-request')!
  if (mode === 'tampered path') requestState.headers.set('x-xp-request', signed.replace('/original', '/variant'))
  if (mode === 'tampered consent') requestState.headers.set('x-xp-request', signed.replace('c1', 'c0'))
  if (mode === 'unsigned') requestState.headers.set('x-xp-request', 'GET|/original|c1')
  if (mode === 'oversized') trustedContext('/' + 'x'.repeat(2048))
  if (mode === 'wrong domain') {
    const value = 'GET|/original|c1'
    requestState.headers.set('x-xp-request', `${value}|${sign(value, secrets)}`)
  }
  const result = await getAssignments(runtime(manifest([page()])).rt)
  expect(result).toMatchObject({ method: 'UNKNOWN', bySlug: { hero: { arm: 'control', exposable: false } } })
})
test.each([false, true])('signed c0 ignores a valid cookie and logged-in user (assignments header %s)', async withHeader => {
  trustedContext('/original', 'GET', false)
  const m = manifest([experiment({ kind: 'flag', flagPoint: 'point', unitType: 'user', status: 'decided', winnerArm: 'variantA' })])
  m.archivedPages['/original'] = { slug: 'old', winnerPath: '/winner' }
  const getUnit = vi.fn(() => ({ userId: 'private-user', attributes: {} })), getUser = vi.fn(async () => ({ id: 'private-user' }))
  if (withHeader) header(assignments(m), m)
  const result = await getAssignments(runtime(m, { getUnit }, { getUser }).rt, { user: { id: 'supplied-user' } })
  expect(result).toMatchObject({ visitorId: undefined, userId: undefined, bySlug: { hero: { arm: 'variantA', exposable: false } }, flagPoints: { point: { arm: 'variantA', exposable: false } } })
  expect(getUnit).toHaveBeenCalledTimes(1)
  expect(getUser).not.toHaveBeenCalled()
})
test('signed c1 with a valid cookie recomputes normally', async () => {
  trustedContext()
  const result = await getAssignments(runtime().rt)
  expect(result).toMatchObject({ visitorId: 'visitor', method: 'GET', bySlug: { hero: { arm: 'variantA', exposable: true, source: 'recomputed' } } })
  expect(resolveExperimentData({ content: [{ type: 'ExperimentSlot', props: { id: 'slot', experiment: { id: 7, slug: 'hero' }, control: [], variantA: [] } }], root: { props: {} } }, result).rendered).toEqual([{ slug: 'hero', arm: 'variantA', phase: 1 }])
})
test.each([true, false])('xp_preview query is honoured only with verified request context (%s)', async valid => {
  const token = signPreviewToken({ e: 7, a: 'control', p: 1, exp: Math.floor(Date.now() / 1000) + 60 }, secrets)
  trustedContext(`/?xp_preview=${token}`)
  if (!valid) requestState.headers.set('x-xp-request', requestState.headers.get('x-xp-request')!.replace('GET|', 'HEAD|'))
  const result = await getAssignments(runtime().rt)
  expect(result.preview).toBe(valid)
  expect(result.bySlug.hero).toMatchObject({ exposable: false, source: valid ? 'preview' : 'fallback' })
})
test('old request-context secret verifies during rotation, preserving raw path and search', async () => {
  trustedContext('/courses/%2F/?q=a|b', 'GET', true, ['old'])
  const context = serverRequest(requestState.headers, secrets)
  expect(context).toMatchObject({ hasContext: true, consent: true })
  expect(context.request.url).toBe('https://xp.invalid/courses/%2F/?q=a|b')
  expect((await getAssignments(runtime().rt)).bySlug.hero!.exposable).toBe(true)
})


test.each([false, true])('c0 recompute preserves proxy attributes and unknown-session handling (%s)', async sessionUnknown => {
  const m = manifest([experiment({ status: 'decided', winnerArm: 'variantA', targeting: [
    { attribute: 'loggedIn', op: 'eq', value: true, type: 'boolean' },
  ] })])
  const getUnit = vi.fn(() => ({ userId: 'must-ignore', attributes: { loggedIn: true, staff: false }, sessionUnknown }))
  const getUser = vi.fn(async () => ({ id: 'also-ignore' }))
  const { rt } = runtime(m, { getUnit, cookie: { consent: () => false } }, { getUser })
  const proxied = await resolveExperiments(new NextRequest('https://example.com/', { headers: requestState.headers }), rt.proxyRuntime)
  requestState.headers = proxied.requestHeaders
  const proxyArm = /hero=(variantA|control)!/.exec(requestState.headers.get('x-xp-assignments')!)![1]
  requestState.headers.delete('x-xp-assignments')
  getUnit.mockClear()
  const result = await getAssignments(rt)
  expect(proxyArm).toBe(sessionUnknown ? 'control' : 'variantA')
  expect(result).toMatchObject({ visitorId: undefined, userId: undefined, sessionUnknown,
    bySlug: { hero: { arm: proxyArm, exposable: false } } })
  expect(getUnit).toHaveBeenCalledTimes(1)
  expect(getUser).not.toHaveBeenCalled()
})
test('c0 with corrupt arms returns empty assignments when consent fallback and controls both fail', async () => {
  trustedContext('/', 'GET', false)
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  const m = manifest([experiment({ status: 'decided', winnerArm: 'variantA', arms: null as unknown as ManifestExperiment['arms'] })])
  m.flagDefaults.point = { winnerArm: 'variantA', params: { text: 'untrusted manifest' }, experiment: 7, decidedAt: '2026-10-31T00:00:00Z' }
  const { rt } = runtime(m, {}, {}, { flagPoints: [{ id: 'point', defaultParams: { text: 'host default' } }] })
  const result = await getAssignments(rt)
  expect(result).toMatchObject({ visitorId: undefined, userId: undefined, bySlug: {}, archivedWinners: {} })
  expect(result.flagPoints).toEqual({ point: { arm: 'control', params: { text: 'host default' }, source: 'default', exposable: false } })
  expect(await getFlagPoint(rt, 'point')).toMatchObject({ params: { text: 'host default' }, source: 'default', exposable: false })
  expect(Object.values(result.bySlug)).toEqual([])
  expect(log).toHaveBeenCalledExactlyOnceWith('[payload-experiments] consent fallback failed; serving non-exposable control')
})

test('Payload load failure with malformed manifest returns empty non-exposable assignments', async () => {
  trustedContext()
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  const m = manifest([experiment({ arms: null as unknown as ManifestExperiment['arms'] })])
  const { rt } = runtime(m, {}, { getPayload: async () => { throw new Error('offline') } })
  expect(await getAssignments(rt)).toMatchObject({ revision: 0, bySlug: {}, flagPoints: {}, archivedWinners: {} })
  expect(log).toHaveBeenCalledExactlyOnceWith('[payload-experiments] getPayload failed; serving non-exposable control')
})
