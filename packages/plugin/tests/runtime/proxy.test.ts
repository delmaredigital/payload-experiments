import { NextRequest, NextResponse } from 'next/server'
import { afterEach, expect, test, vi } from 'vitest'
import { assignArm } from '@delmaredigital/experiments-stats'
import { applyExperiments } from '../../src/proxy/apply.js'
import { createExperimentProxy } from '../../src/proxy/createProxy.js'
import { resolveExperiments, type ExperimentsProxyResult } from '../../src/proxy/resolve.js'
import { encodeUnitCookie, verifyUnitCookie } from '../../src/runtime/cookie.js'
import * as header from '../../src/runtime/header.js'
import { signPreviewToken } from '../../src/runtime/previewToken.js'
import { defineExperimentsProxyRuntime } from '../../src/runtime/proxyRuntime.js'
import type { Manifest, ManifestExperiment } from '../../src/types/manifest.js'
import type { ExperimentsProxyRuntimeOptions } from '../../src/types/runtime.js'

const secrets = ['proxy-test-key']
const experiment = (patch: Partial<ManifestExperiment> = {}): ManifestExperiment => ({
  id: 'e1', slug: 'hero', kind: 'code', unitType: 'visitor', status: 'running',
  phase: 1, phaseKind: 'test', seed: '0123456789abcdef0123456789abcdef|', coverage: 1,
  arms: [{ key: 'control', kind: 'control', weight: 50 }, { key: 'variantA', kind: 'variant', weight: 50 }],
  targeting: [], exposurePolicy: 'manual', deferrable: false, ...patch,
})
const manifest = (experiments = [experiment()]): Manifest => ({ v: 1, revision: 7, experiments, flagDefaults: {}, archivedWinners: {}, archivedPages: {} })
const runtime = (m = manifest(), patch: Partial<ExperimentsProxyRuntimeOptions> = {}) => defineExperimentsProxyRuntime({
  secret: secrets, apiRoute: '/api', loadManifest: async () => m, ...patch,
})
const request = (path = '/', init?: ConstructorParameters<typeof NextRequest>[1]) => new NextRequest(`https://example.com${path}`, init)
const signedRequest = (path = '/', unitId = 'visitor') => request(path, { headers: { cookie: `xp_id=${encodeUnitCookie(unitId, secrets)}` } })
function decode(result: ExperimentsProxyResult, m: Manifest, visitorId?: string, userId?: string) {
  const value = result.requestHeaders.get('x-xp-assignments')
  expect(value).not.toBeNull()
  const decoded = header.decodeAssignmentsHeader(value!, { secrets, manifest: m, visitorId, userId })
  expect(decoded).not.toBeNull()
  return decoded!
}
const page = (patch: Partial<ManifestExperiment> = {}) => experiment({ kind: 'page', exposurePolicy: 'pageview', arms: [
  { key: 'control', kind: 'control', weight: 0, pageTarget: '/original' },
  { key: 'variantA', kind: 'variant', weight: 100, pageTarget: '/variant' },
], ...patch })
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

test('strips every inbound xp header and forwards a minted signed cookie on this request', async () => {
  const m = manifest(), req = request('/', { headers: {
    'X-XP-Assignments': 'attacker', 'x-xp-anything': 'attacker', cookie: 'other=keep%3Bencoded', 'x-host': 'keep',
  } })
  const result = await resolveExperiments(req, runtime(m))
  expect(result.setCookies).toHaveLength(1)
  const cookie = result.setCookies[0]!
  const visitorId = verifyUnitCookie(cookie.value, secrets)!
  expect(visitorId).toBeTruthy()
  expect(result.requestCookies).toEqual([{ name: 'xp_id', value: cookie.value }])
  expect(result.requestHeaders.get('cookie')).toBe(`other=keep%3Bencoded; xp_id=${cookie.value}`)
  expect(result.requestHeaders.get('x-xp-anything')).toBeNull()
  expect(result.requestHeaders.get('x-host')).toBe('keep')
  expect(decode(result, m, visitorId).bySlug.hero).toMatchObject({ exposable: true })
  expect(req.headers.get('x-xp-assignments')).toBe('attacker')
  expect(req.cookies.has('xp_id')).toBe(false)
})
test.each(['unsigned', `${encodeUnitCookie('old', secrets)}x`, encodeUnitCookie('old', ['wrong-key'])])('replaces an invalid cookie: %s', async value => {
  const result = await resolveExperiments(request('/', { headers: { cookie: `xp_id=${value}` } }), runtime())
  expect(result.setCookies).toHaveLength(1)
  expect(verifyUnitCookie(result.setCookies[0]!.value, secrets)).toBeTruthy()
  expect(result.requestHeaders.get('cookie')).not.toContain(value)
})
test('keeps a valid cookie without setting it again', async () => {
  const m = manifest(), req = signedRequest()
  const result = await resolveExperiments(req, runtime(m))
  expect(result.setCookies).toEqual([])
  expect(result.requestCookies).toEqual([])
  expect(result.requestHeaders.get('cookie')).toBe(req.headers.get('cookie'))
  expect(decode(result, m, 'visitor').bySlug.hero!.exposable).toBe(true)
})
test('consent false mints nothing and serves non-exposable control', async () => {
  const m = manifest(), result = await resolveExperiments(request(), runtime(m, { cookie: { consent: () => false } }))
  expect(result.setCookies).toEqual([])
  expect(result.requestCookies).toEqual([])
  expect(result.requestHeaders.has('cookie')).toBe(false)
  expect(decode(result, m).bySlug.hero).toMatchObject({ arm: 'control', exposable: false })
})
test.each(['http:', 'https:'])('cookie attributes use Secure only on https (%s)', async protocol => {
  const result = await resolveExperiments(new NextRequest(`${protocol}//example.com/`), runtime(manifest(), {
    cookie: { name: 'custom_id', maxAgeDays: 30, domain: '.example.com' },
  }))
  expect(result.setCookies[0]).toMatchObject({ name: 'custom_id', httpOnly: true, sameSite: 'lax', path: '/', maxAge: 30 * 86400, domain: '.example.com' })
  expect(result.setCookies[0]!.secure).toBe(protocol === 'https:' ? true : undefined)
  expect(result.requestHeaders.get('cookie')).toContain('custom_id=')
})
test('signed header matches stats for 100 units including units outside allocation', async () => {
  const e = experiment({ coverage: 0.5 }), m = manifest([e]), rt = runtime(m)
  const seen = new Set<string>()
  for (let i = 0; i < 100; i++) {
    const id = `visitor-${i}`, result = await resolveExperiments(signedRequest('/', id), rt)
    const index = assignArm({ seed: e.seed, unitId: id, weights: e.arms.map(arm => arm.weight), coverage: e.coverage })
    const expected = { arm: index === -1 ? 'control' : e.arms[index]!.key, exposable: index !== -1 }
    expect(decode(result, m, id).bySlug.hero).toMatchObject(expected)
    seen.add(`${expected.arm}:${expected.exposable}`)
  }
  expect(seen.size).toBe(3)
})
test('40 experiments fit within 1 KB and hashed slugs decode', async () => {
  const m = manifest(Array.from({ length: 40 }, (_, i) => experiment({ id: i, slug: `experiment-with-a-long-name-${i}` })))
  const result = await resolveExperiments(signedRequest(), runtime(m))
  const value = result.requestHeaders.get('x-xp-assignments')!
  expect(Buffer.byteLength(value)).toBeLessThanOrEqual(1024)
  expect(value).toContain('#')
  expect(Object.keys(decode(result, m, 'visitor').bySlug)).toHaveLength(40)
})
test.each(['staff', 'bot', 'sessionUnknown'] as const)('%s sets its signed flag', async flag => {
  const m = manifest(), req = signedRequest()
  if (flag === 'bot') req.headers.set('user-agent', 'Googlebot')
  const result = await resolveExperiments(req, runtime(m, {
    getUnit: () => ({ attributes: { staff: flag === 'staff' }, sessionUnknown: flag === 'sessionUnknown' }),
  }))
  const decoded = decode(result, m, 'visitor')
  expect(decoded[flag]).toBe(true)
  expect(result.requestHeaders.get('x-xp-assignments')!.split('.')[2]).toBe({ staff: 's', bot: 'b', sessionUnknown: 'u' }[flag])
  expect(decoded.bySlug.hero!.exposable).toBe(flag === 'sessionUnknown')
})
test('HEAD is assigned without exposure', async () => {
  const m = manifest(), result = await resolveExperiments(request('/', { method: 'HEAD', headers: { cookie: `xp_id=${encodeUnitCookie('visitor', secrets)}` } }), runtime(m))
  expect(decode(result, m, 'visitor').bySlug.hero!.exposable).toBe(false)
})
test('defers missing user ids and unknown session targeting; ordinary deferrable visitors still assign', async () => {
  const m = manifest([
    experiment({ slug: 'user', unitType: 'user', deferrable: true }),
    experiment({ slug: 'session', deferrable: true, targeting: [{ attribute: 'loggedIn', op: 'eq', value: true }] }),
    experiment({ slug: 'visitor', deferrable: true }),
  ])
  const result = await resolveExperiments(signedRequest(), runtime(m, { getUnit: async () => ({ attributes: {}, sessionUnknown: true }) }))
  expect(decode(result, m, 'visitor')).toMatchObject({ deferred: ['user', 'session'], bySlug: { visitor: { exposable: true } } })
  expect(result.requestHeaders.get('x-xp-assignments')).toContain('?user;?session')
  const known = await resolveExperiments(signedRequest(), runtime(m, { getUnit: () => ({ userId: 'user-1', attributes: { loggedIn: true } }) }))
  expect(decode(known, m, 'visitor', 'user-1').deferred).toEqual([])
})
test('adds pathname without query over host attributes before targeting', async () => {
  const m = manifest([experiment({ targeting: [{ attribute: 'path', op: 'eq', value: '/landing' }] })])
  const rt = runtime(m, { getUnit: () => ({ attributes: { path: '/wrong' } }) })
  expect(decode(await resolveExperiments(signedRequest('/landing?q=1'), rt), m, 'visitor').bySlug.hero!.exposable).toBe(true)
  expect(decode(await resolveExperiments(signedRequest('/elsewhere'), rt), m, 'visitor').bySlug.hero!.exposable).toBe(false)
})
test.each(['/original', '/variant'])('page request %s rewrites to assigned arm and preserves query', async path => {
  const result = await resolveExperiments(signedRequest(`${path}?q=1`), runtime(manifest([page()])))
  expect(result.rewrite?.href).toBe('https://example.com/variant?q=1')
})
test('holdout page assignment serves the control page and remains measurable', async () => {
  const m = manifest([page({ arms: [
    { key: 'control', kind: 'control', weight: 0, pageTarget: '/original' }, { key: 'holdout', kind: 'holdout', weight: 100 },
  ] })])
  const result = await resolveExperiments(signedRequest('/original'), runtime(m))
  expect(result.rewrite?.pathname).toBe('/original')
  expect(decode(result, m, 'visitor').bySlug.hero).toMatchObject({ arm: 'holdout', exposable: true })
})
test('a deferred page serves control and signs control! instead of permitting later variant exposure', async () => {
  const m = manifest([
    page({ deferrable: true, targeting: [{ attribute: 'loggedIn', op: 'eq', value: true }] }),
    experiment({ slug: 'other', unitType: 'user', deferrable: true }),
  ])
  const result = await resolveExperiments(signedRequest('/original'), runtime(m, {
    getUnit: () => ({ attributes: {}, sessionUnknown: true }),
  }))
  expect(result.rewrite?.pathname).toBe('/original')
  expect(decode(result, m, 'visitor')).toMatchObject({
    sessionUnknown: true, deferred: ['other'], bySlug: { hero: { arm: 'control', exposable: false } },
  })
  expect(result.requestHeaders.get('x-xp-assignments')).toContain('hero=control!')
})
test.each([undefined, 'https://elsewhere.com/steal', '//elsewhere.com/steal', '/\\elsewhere.com/steal', 'http://['])('unresolvable assigned page %s falls back to control before header signing', async target => {
  const e = page(); e.arms[1]!.pageTarget = target
  const m = manifest([e]), result = await resolveExperiments(signedRequest('/original'), runtime(m))
  expect(result.rewrite?.pathname).toBe('/original')
  expect(decode(result, m, 'visitor').bySlug.hero).toMatchObject({ arm: 'control', exposable: false })
})
test('archived control and losing paths rewrite to winner; live page experiment wins', async () => {
  const m = manifest([])
  m.archivedPages = { '/original': { slug: 'old', winnerPath: '/winner' }, '/loser': { slug: 'old', winnerPath: '/winner' } }
  const rt = runtime(m)
  for (const path of ['/original', '/loser']) {
    const result = await resolveExperiments(signedRequest(path), rt)
    expect(result.rewrite?.pathname).toBe('/winner')
    expect(decode(result, m, 'visitor').bySlug).toEqual({})
  }
  const live = { ...m, experiments: [page()] }
  expect((await resolveExperiments(signedRequest('/original'), runtime(live))).rewrite?.pathname).toBe('/variant')
  expect((await resolveExperiments(signedRequest('/unrelated'), rt)).rewrite).toBeUndefined()
})
test.each(['running', 'decided'] as const)('valid preview for %s forces arm, p flag, no exposures and no-store', async status => {
  const m = manifest([experiment({ status, ...(status === 'decided' ? { winnerArm: 'variantA' } : {}), arms: [
    { key: 'control', kind: 'control', weight: 100 }, { key: 'variantA', kind: 'variant', weight: 0 },
  ] }), experiment({ id: 'other', slug: 'other' })])
  const token = signPreviewToken({ e: 'e1', a: 'variantA', p: 1, exp: Math.floor(Date.now() / 1000) + 60 }, secrets)
  const result = await resolveExperiments(signedRequest(`/?xp_preview=${token}`), runtime(m))
  const decoded = decode(result, m, 'visitor')
  expect(decoded.preview).toBe(true)
  expect(decoded.bySlug.hero!.arm).toBe('variantA')
  expect(Object.values(decoded.bySlug).every(entry => !entry.exposable)).toBe(true)
  expect(result.requestHeaders.get('x-xp-assignments')!.split('.')[2]).toBe('p')
  expect(result.responseHeaders?.get('cache-control')).toBe('no-store')
})
test.each(['tampered', 'expired', 'phase', 'experiment', 'arm'])('invalid preview %s is ignored', async invalid => {
  const now = Math.floor(Date.now() / 1000), m = manifest()
  let token = signPreviewToken({ e: invalid === 'experiment' ? 'missing' : 'e1', a: invalid === 'arm' ? 'variantC' : 'variantA', p: invalid === 'phase' ? 2 : 1, exp: now + 60 }, secrets)
  if (invalid === 'tampered') token += 'x'
  if (invalid === 'expired') vi.spyOn(Date, 'now').mockReturnValue((now + 61) * 1000)
  const result = await resolveExperiments(signedRequest(`/?xp_preview=${token}`), runtime(m))
  expect(decode(result, m, 'visitor').preview).toBe(false)
  expect(result.responseHeaders).toBeUndefined()
})
test.each(['/admin', '/admin/collections', '/_next', '/_next/static/a', '/api', '/api/xp/events', '/logo.png', '/assets/file.woff2'])('skip %s changes nothing and calls no adapters', async path => {
  const loadManifest = vi.fn(), getUnit = vi.fn(), req = request(path, { headers: { 'x-xp-anything': 'untouched', cookie: 'other=keep' } })
  const result = await resolveExperiments(req, runtime(manifest(), { loadManifest, getUnit }))
  expect([...result.requestHeaders]).toEqual([...req.headers])
  expect(result.setCookies).toEqual([])
  expect(result.requestCookies).toEqual([])
  expect(result.rewrite).toBeUndefined()
  expect(loadManifest).not.toHaveBeenCalled()
  expect(getUnit).not.toHaveBeenCalled()
})
test('skip respects custom API prefix and segment boundaries', async () => {
  const rt = runtime(manifest(), { apiRoute: '/backend/' })
  expect((await resolveExperiments(request('/backend/xp/events'), rt)).setCookies).toEqual([])
  expect((await resolveExperiments(request('/backendish'), rt)).setCookies).toHaveLength(1)
  expect((await resolveExperiments(request('/administrator'), rt)).setCookies).toHaveLength(1)
})
test('cache is shared per runtime, isolated across runtimes, and uses the last good manifest on refresh failure', async () => {
  vi.useFakeTimers()
  const m = manifest(), loadManifest = vi.fn().mockResolvedValueOnce(m).mockRejectedValueOnce(new Error('offline'))
  const rt = runtime(m, { loadManifest })
  await Promise.all([resolveExperiments(signedRequest(), rt), resolveExperiments(signedRequest(), rt)])
  expect(loadManifest).toHaveBeenCalledTimes(1)
  vi.advanceTimersByTime(30_001)
  const result = await resolveExperiments(signedRequest(), rt)
  expect(decode(result, m, 'visitor').bySlug.hero!.exposable).toBe(true)
  expect(loadManifest).toHaveBeenCalledTimes(2)
  expect(loadManifest).toHaveBeenLastCalledWith({ ifRevision: m.revision })
  const other = manifest([])
  expect(decode(await resolveExperiments(signedRequest(), runtime(other)), other, 'visitor').bySlug).toEqual({})
})
test.each(['no loader', 'null', 'failure', 'slow'])('cold start (%s) contains no exposable assignments and never rewrites', async mode => {
  vi.useFakeTimers()
  const m = manifest([page()])
  const loadManifest = mode === 'no loader' ? undefined : mode === 'null' ? async () => null
    : mode === 'failure' ? async () => { throw new Error('offline') } : () => new Promise<Manifest>(() => {})
  const pending = resolveExperiments(signedRequest('/original'), runtime(m, { loadManifest }))
  await vi.advanceTimersByTimeAsync(1500)
  const result = await pending
  expect(result.rewrite).toBeUndefined()
  // Without a manifest no slugs are known; absence means non-exposable control to the server.
  const empty = { ...manifest([]), revision: 0 }
  expect(decode(result, empty, 'visitor').bySlug).toEqual({})
  await vi.advanceTimersByTimeAsync(5000)
})
test('encoder overflow omits the header without failing the request', async () => {
  vi.spyOn(header, 'encodeAssignmentsHeader').mockImplementation(() => { throw new RangeError('over budget') })
  const result = await resolveExperiments(request('/', { headers: { 'x-xp-assignments': 'attacker' } }), runtime())
  expect(result.requestHeaders.has('x-xp-assignments')).toBe(false)
  expect(result.setCookies).toHaveLength(1)
})
test('apply copies cookies and response headers onto the same response', () => {
  const response = NextResponse.next(), result: ExperimentsProxyResult = {
    requestHeaders: new Headers(), requestCookies: [], setCookies: [{ name: 'xp_id', value: 'signed', httpOnly: true, path: '/' }],
    responseHeaders: new Headers({ 'cache-control': 'no-store' }),
  }
  response.headers.set('x-host', 'keep')
  expect(applyExperiments(response, result)).toBe(response)
  expect(response.cookies.get('xp_id')?.value).toBe('signed')
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(response.headers.get('x-host')).toBe('keep')
})
test('wrapper forwards the cookie/header and sets response cookies on NextResponse.next', async () => {
  const response = await createExperimentProxy(runtime())(request())
  const cookie = response.cookies.get('xp_id')!
  expect(verifyUnitCookie(cookie.value, secrets)).toBeTruthy()
  expect(response.headers.get('x-middleware-next')).toBe('1')
  expect(response.headers.get('x-middleware-request-cookie')).toBe(`xp_id=${cookie.value}`)
  expect(response.headers.get('x-middleware-request-x-xp-assignments')).toBeTruthy()
})
test('wrapper rewrites with forwarded headers and applies preview no-store', async () => {
  const token = signPreviewToken({ e: 'e1', a: 'variantA', p: 1, exp: Math.floor(Date.now() / 1000) + 60 }, secrets)
  const response = await createExperimentProxy(runtime(manifest([page()])))(request(`/original?xp_preview=${token}`))
  expect(new URL(response.headers.get('x-middleware-rewrite')!).pathname).toBe('/variant')
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(response.headers.get('x-middleware-request-cookie')).toContain('xp_id=')
  expect(response.cookies.has('xp_id')).toBe(true)
})
