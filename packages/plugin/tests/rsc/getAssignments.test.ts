import { afterEach, expect, test, vi } from 'vitest'
import { requestState, newRequest } from './requestHarness.js'
import { assignments, experiment, manifest, page, runtime, secrets } from './helpers.js'
import { getAssignments } from '../../src/server/getAssignments.js'
import { encodeAssignmentsHeader } from '../../src/runtime/header.js'
import { signPreviewToken } from '../../src/runtime/previewToken.js'
import { resolveExperimentData } from '../../src/server/resolveExperimentData.js'

afterEach(() => vi.restoreAllMocks())
const header = (a = assignments(), m = manifest()) => requestState.headers.set('x-xp-assignments', encodeAssignmentsHeader(a, { secrets, manifest: m }))

test('verified header is used and archived winners and method are copied', async () => {
  const a = assignments(); a.userId = undefined; a.bySlug.hero!.arm = 'control'
  header(a)
  requestState.headers.set('x-invoke-method', 'HEAD')
  const result = await getAssignments(runtime().rt)
  expect(result.bySlug.hero).toMatchObject({ arm: 'control', source: 'header', exposable: false })
  expect(result.archivedWinners).toEqual({ archived: 'variantB' })
  expect(result.method).toBe('HEAD')
})
test('tampered header recomputes exactly like shared assign', async () => {
  requestState.headers.set('x-xp-assignments', 'v1.3..hero=control.invalid')
  const result = await getAssignments(runtime().rt)
  expect(result.bySlug).toEqual(assignments().bySlug)
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
test('still-newer header reloads once then recomputes; older header recomputes without reload', async () => {
  for (const revision of [2, 4]) {
    newRequest()
    const m = { ...manifest(), revision }, a = assignments(m); a.userId = undefined; header(a, m)
    const { rt, loadManifest } = runtime()
    expect((await getAssignments(rt)).bySlug.hero!.source).toBe('recomputed')
    expect(loadManifest).toHaveBeenCalledTimes(revision === 4 ? 2 : 1)
  }
})
test('deferred slug resolves getUser/userIdOf and server attributes', async () => {
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
  requestState.headers.set('x-url', `https://example.com/?xp_preview=${token}`)
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
