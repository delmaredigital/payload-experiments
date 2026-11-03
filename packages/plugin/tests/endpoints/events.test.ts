import { readFileSync, readdirSync } from 'node:fs'
import type { PayloadRequest } from 'payload'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { DEFAULT_MAX_BODY_BYTES } from '../../src/constants.js'
import { resolveOptions } from '../../src/options.js'
import { insertEvents } from '../../src/db/events.js'
import { handleEvents } from '../../src/endpoints/events.js'
import { buildEndpoints } from '../../src/endpoints/index.js'
import { assign } from '../../src/runtime/assign.js'
import { encodeUnitCookie } from '../../src/runtime/cookie.js'
import { defineExperimentsProxyRuntime } from '../../src/runtime/proxyRuntime.js'
import { NextRequest } from 'next/server.js'
import { resolveExperiments } from '../../src/proxy/resolve.js'
import { decodeAssignmentsHeader } from '../../src/runtime/header.js'
import { defineExperimentsServerRuntime } from '../../src/server/serverRuntime.js'
import type { ResolvedOptions } from '../../src/types/contracts.js'
import type { Manifest, ManifestExperiment } from '../../src/types/manifest.js'

vi.mock('../../src/db/events.js', () => ({ insertEvents: vi.fn(async () => 1) }))
const insert = vi.mocked(insertEvents)
const ts = '2026-10-31T03:30:00.000Z'
const secrets = ['current', 'previous']
const signed = encodeUnitCookie('visitor', secrets)
const conversion = { type: 'conversion', eventName: 'registration', idempotencyKey: 'key' }
const exposure = { type: 'exposure', experiment: 'example-experiment', phase: 1, arm: 'variantA', policy: 'manual' }
function experiment(patch: Partial<ManifestExperiment> = {}): ManifestExperiment {
  return { id: 42, slug: 'example-experiment', kind: 'code', unitType: 'visitor', status: 'running', phase: 1, phaseKind: 'test',
    seed: 'events-seed|', coverage: 1, arms: [{ key: 'control', kind: 'control', weight: 0 }, { key: 'variantA', kind: 'variant', weight: 100 }],
    targeting: [], exposurePolicy: 'manual', deferrable: false, ...patch }
}
function fixture(patch: Partial<ManifestExperiment> = {}) {
  const manifest: Manifest = { v: 1, revision: 1, experiments: [experiment(patch)], flagDefaults: {}, archivedWinners: {}, archivedPages: {} }
  const load = vi.fn(async (): Promise<Manifest | null> => manifest)
  const proxy = defineExperimentsProxyRuntime({ secret: secrets, apiRoute: '/api', loadManifest: load })
  const runtime = defineExperimentsServerRuntime(proxy, { getPayload: vi.fn(), attributesOf: user => ({ loggedIn: Boolean(user) }) })
  const options: ResolvedOptions = { runtime, access: { manage: () => false }, eventSources: [{ name: 'registration', clientWritable: true }],
    attributeKeys: { campaign: { type: 'string' }, amount: { type: 'number' }, member: { type: 'boolean' } } }
  const error = vi.fn()
  const execute = vi.fn(async () => ({ rows: [] }))
  function request(body: unknown = { events: [exposure, conversion] }, headers: Record<string, string> = {},
    extra: { raw?: boolean; cookie?: string | null; user?: { id: string | number }; url?: string } = {}): PayloadRequest {
    const req = new Request(extra.url ?? 'https://example.test/api/xp/events', {
      method: 'POST', headers: { ...(extra.cookie === null ? {} : { cookie: `xp_id=${extra.cookie ?? signed}` }), ...headers },
      body: extra.raw ? body as BodyInit : JSON.stringify(body), duplex: 'half',
    } as RequestInit)
    return Object.assign(req, { payload: { logger: { error }, db: { drizzle: { execute } } }, user: extra.user }) as unknown as PayloadRequest
  }
  const run = (req: PayloadRequest) => handleEvents(req, { options })
  return { options, manifest, load, request, run, error, execute }
}
async function accepted(response: Response) {
  expect(response.status).toBe(202)
  expect(await response.text()).toBe('{}')
}
const stored = () => insert.mock.calls.flatMap(call => call[1])
beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers().setSystemTime(new Date(ts)) })
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

const fixtureDirectory = new URL('../_fixtures/events/', import.meta.url)
for (const name of readdirSync(fixtureDirectory).filter(name => name.endsWith('.json'))) {
  test.each(['text/plain', 'application/json'])(`accepts shared ${name} as %s`, async contentType => {
    const body = JSON.parse(readFileSync(new URL(name, fixtureDirectory), 'utf8'))
    const policy = body.events.find((event: { type: string }) => event.type === 'exposure')?.policy ?? 'manual'
    const f = fixture({ exposurePolicy: policy })
    await accepted(await f.run(f.request(body, { 'content-type': contentType })))
    expect(stored()).toHaveLength(body.events.length)
    expect(insert).toHaveBeenCalledOnce()
  })
}

test('empty batch is accepted without a write', async () => {
  const f = fixture()
  await accepted(await f.run(f.request({ events: [] })))
  expect(insert).not.toHaveBeenCalled()
})
test.each(['{', 'null', '[]', '{}', '{"events":null}', '{"events":{}}', JSON.stringify({ events: Array(21).fill(conversion) })])('malformed body is 422 (%s)', async body => {
  const f = fixture()
  const response = await f.run(f.request(body, {}, { raw: true }))
  expect(response.status).toBe(422)
  expect(await response.json()).toMatchObject({ errors: [{ code: 'invalid-body' }] })
  expect(insert).not.toHaveBeenCalled()
})
test('absent and failed body streams are 422', async () => {
  const f = fixture()
  for (const body of [null, new ReadableStream({ start(controller) { controller.error(new Error('stream failed')) } })]) {
    expect((await f.run(f.request(body, {}, { raw: true }))).status).toBe(422)
  }
})
test.each([undefined, '1'])('stops a chunked over-cap body with Content-Length %s', async length => {
  const f = fixture()
  const cancel = vi.fn()
  let reads = 0
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) { reads++; controller.enqueue(new Uint8Array(4096)) }, cancel,
  }, { highWaterMark: 0 })
  const response = await f.run(f.request(stream, length ? { 'content-length': length } : {}, { raw: true }))
  expect(response.status).toBe(413)
  expect(await response.json()).toMatchObject({ errors: [{ code: 'body-too-large' }] })
  expect(reads).toBe(3)
  expect(cancel).toHaveBeenCalledOnce()
  expect(insert).not.toHaveBeenCalled()
})
test('exactly the default cap is accepted, regardless of declared length', async () => {
  const f = fixture()
  const json = JSON.stringify({ events: [conversion] })
  const body = json + ' '.repeat(DEFAULT_MAX_BODY_BYTES - Buffer.byteLength(json))
  await accepted(await f.run(f.request(body, { 'content-length': '9999999' }, { raw: true })))
  expect(stored()).toHaveLength(1)
})
test('custom cap counts UTF-8 bytes, including across chunk boundaries', async () => {
  const f = fixture()
  const bytes = new TextEncoder().encode(JSON.stringify({ events: [{ ...conversion, idempotencyKey: 'é' }] }))
  f.options.events = { maxBodyBytes: bytes.byteLength }
  const stream = new ReadableStream<Uint8Array>({ start(controller) {
    for (const byte of bytes) controller.enqueue(new Uint8Array([byte]))
    controller.close()
  } })
  await accepted(await f.run(f.request(stream, {}, { raw: true })))
  f.options.events.maxBodyBytes = bytes.byteLength - 1
  expect((await f.run(f.request(bytes, {}, { raw: true }))).status).toBe(413)
})
test.each([null, 'visitor', `${signed.slice(0, -1)}!`, encodeUnitCookie('visitor', ['wrong'])])('requires a signed cookie (%s)', async cookie => {
  const f = fixture()
  const req = f.request(undefined, {}, { cookie })
  expect((await handleEvents(req, { options: f.options, unit: { visitorId: 'forged-context' } })).status).toBe(401)
  const endpoint = buildEndpoints({ options: f.options }).find(route => route.path === '/xp/events')!
  expect((await endpoint.handler(f.request(undefined, {}, { cookie }))).status).toBe(401)
  expect(insert).not.toHaveBeenCalled()
})
test('accepts rotated secrets and the configured cookie name through the registered endpoint', async () => {
  const f = fixture()
  f.options.runtime.proxyRuntime = { ...f.options.runtime.proxyRuntime, cookie: { name: 'custom-id', maxAgeDays: 1 } }
  const req = f.request(undefined, { cookie: `custom-id=${encodeUnitCookie('visitor', ['previous'])}` })
  const endpoint = buildEndpoints({ options: f.options }).find(route => route.path === '/xp/events')!
  await accepted(await endpoint.handler(req))
  expect(stored()).toHaveLength(2)
})
test.each(['false', 'throws'])('consent %s suppresses all storage with a stale cookie', async mode => {
  const f = fixture()
  f.options.events = { dimensions: ['loggedIn', 'path'] }
  const consent = vi.fn(request => {
    expect(request.cookies.get('xp_id')?.value).toBe(signed)
    expect(request.nextUrl.pathname).toBe('/api/xp/events')
    if (mode === 'throws') throw new Error('consent unavailable')
    return false
  })
  f.options.runtime.proxyRuntime = { ...f.options.runtime.proxyRuntime, cookie: { ...f.options.runtime.proxyRuntime.cookie, consent } }
  await accepted(await f.run(f.request()))
  expect(consent).toHaveBeenCalledOnce()
  expect(f.load).not.toHaveBeenCalled()
  expect(insert).not.toHaveBeenCalled()
})
test.each(['false', 'throws'])('rate limiter %s returns no-oracle response with no writes', async mode => {
  const f = fixture()
  const rateLimit = vi.fn(async () => { if (mode === 'throws') throw new Error('limiter down'); return false })
  f.options.events = { rateLimit }
  const req = f.request()
  await accepted(await f.run(req))
  expect(rateLimit).toHaveBeenCalledWith({ req, unitId: 'visitor' })
  expect(insert).not.toHaveBeenCalled()
})
test('true rate limiter permits storage', async () => {
  const f = fixture()
  f.options.events = { rateLimit: async () => true }
  await accepted(await f.run(f.request()))
  expect(stored()).toHaveLength(2)
})
test.each(['bot', 'staff', 'proxy-staff', 'preview-query', 'preview-referrer', 'draft-cookie'])('%s suppresses exposures and mismatch diagnostics', async mode => {
  const f = fixture()
  if (mode === 'staff') f.options.runtime.attributesOf = () => ({ staff: true })
  if (mode === 'proxy-staff') f.options.runtime.proxyRuntime = { ...f.options.runtime.proxyRuntime, getUnit: async () => ({ attributes: { staff: true } }) }
  const headers: Record<string, string> = mode === 'bot' ? { 'user-agent': 'Googlebot' }
    : mode === 'preview-referrer' ? { referer: 'https://example.test/page?xp_preview=token' }
    : mode === 'draft-cookie' ? { cookie: `xp_id=${signed}; __prerender_bypass=draft` } : {}
  await accepted(await f.run(f.request({ events: [exposure, { ...exposure, arm: 'control' }, conversion] }, headers,
    { url: `https://example.test/api/xp/events${mode === 'preview-query' ? '?xp_preview=token' : ''}` })))
  expect(stored().map(row => row.type)).toEqual(['conversion'])
})
test.each(['phase', 'policy', 'render', 'stopped', 'allocation', 'layer', 'targeting', 'unknown', 'missing-user', 'decided-no-rollout'])('drops non-exposable or invalid %s exposure', async mode => {
  const f = fixture()
  let event = { ...exposure }
  const exp = f.manifest.experiments[0]!
  if (mode === 'phase') event.phase++
  if (mode === 'policy') event.policy = 'viewport'
  if (mode === 'render') { exp.exposurePolicy = 'render'; event.policy = 'render' }
  if (mode === 'stopped') (exp as unknown as { status: string }).status = 'stopped'
  if (mode === 'allocation') exp.coverage = 0
  if (mode === 'layer') exp.layer = { slug: 'layer', slices: [] }
  if (mode === 'targeting') exp.targeting = [{ attribute: 'loggedIn', type: 'boolean', op: 'eq', value: true }]
  if (mode === 'unknown') event.experiment = 'unknown'
  if (mode === 'missing-user') exp.unitType = 'user'
  if (mode === 'decided-no-rollout') { exp.status = 'decided'; exp.winnerArm = 'variantA' }
  await accepted(await f.run(f.request({ events: [event, { ...event, arm: 'control' }] })))
  expect(insert).not.toHaveBeenCalled()
})
test('a decided rollout still exposes its assigned arm', async () => {
  const f = fixture({ status: 'decided', phaseKind: 'rollout', winnerArm: 'variantA', holdoutKey: 'holdout', arms: [
    { key: 'control', kind: 'control', weight: 0 }, { key: 'variantA', kind: 'variant', weight: 99 }, { key: 'holdout', kind: 'holdout', weight: 1 },
  ] })
  await accepted(await f.run(f.request({ events: [exposure] })))
  expect(stored()).toMatchObject([{ type: 'exposure', arm: 'variantA' }])
})
test('mismatches use diagnostic rows and one daily key per experiment, phase and unit', async () => {
  const f = fixture()
  const bad = { ...exposure, arm: 'control' }
  await accepted(await f.run(f.request({ events: [bad, { ...bad, arm: 'variantB' }] })))
  expect(stored()).toMatchObject([{ type: 'arm-mismatch', experimentId: 42, phase: 1, unitType: 'visitor', unitId: 'visitor',
    ts, dedupeKey: 'mismatch:42:1:visitor:2026-10-31' }])
  expect(insert).toHaveBeenCalledOnce()
  await accepted(await f.run(f.request({ events: [bad] })))
  expect(stored().map(row => row.dedupeKey)).toEqual(Array(2).fill('mismatch:42:1:visitor:2026-10-31'))
  vi.setSystemTime(new Date('2026-11-01T00:00:00Z'))
  await accepted(await f.run(f.request({ events: [bad] })))
  expect(stored().at(-1)?.dedupeKey).toBe('mismatch:42:1:visitor:2026-11-01')
})
test('authenticated user units use req.user via userIdOf, ignoring proxy user identity', async () => {
  const f = fixture({ unitType: 'user', arms: [
    { key: 'control', kind: 'control', weight: 50 }, { key: 'variantA', kind: 'variant', weight: 50 },
  ] })
  const runtime = f.options.runtime
  runtime.userIdOf = vi.fn(user => `host-${user.id}`)
  runtime.getUser = vi.fn(async () => { throw new Error('req.user is authoritative') })
  const attributesOf = vi.fn(user => ({ loggedIn: Boolean(user), member: true }))
  runtime.attributesOf = attributesOf
  runtime.proxyRuntime = { ...runtime.proxyRuntime, getUnit: async () => ({ userId: 'proxy-user', attributes: { member: false } }) }
  const assignments = assign(f.manifest, { visitorId: 'visitor', userId: 'host-123' }, { loggedIn: true }, { now: 0 })
  const arm = assignments.bySlug['example-experiment']!.arm
  await accepted(await f.run(f.request({ events: [{ ...exposure, arm }, conversion] }, {}, { user: { id: 123 } })))
  expect(runtime.userIdOf).toHaveBeenCalledWith({ id: 123 })
  expect(runtime.getUser).not.toHaveBeenCalled()
  expect(attributesOf).toHaveBeenCalledWith({ id: 123 })
  expect(stored()).toMatchObject([
    { type: 'exposure', unitId: 'host-123', unitType: 'user', userId: 'host-123', dedupeKey: `exposure:42:1:${arm}:host-123:2026-10-31` },
    { type: 'conversion', unitId: 'visitor', userId: 'host-123' },
  ])
})
test('server attributes override proxy attributes for targeting', async () => {
  const f = fixture({ targeting: [{ attribute: 'member', type: 'boolean', op: 'eq', value: true }] })
  f.options.runtime.proxyRuntime = { ...f.options.runtime.proxyRuntime, getUnit: async () => ({ attributes: { member: false } }) }
  f.options.runtime.attributesOf = () => ({ member: true })
  await accepted(await f.run(f.request({ events: [exposure] })))
  expect(stored()).toHaveLength(1)
})
test('recomputes page-path targeting from a same-origin referrer with the shared normalization', async () => {
  const f = fixture({ targeting: [{ attribute: 'path', type: 'string', op: 'eq', value: '/article' }] })
  const getUnit = vi.fn(async request => {
    expect(request.nextUrl.pathname).toBe('/article//')
    return { userId: 'untrusted-proxy-user', attributes: { path: '/wrong' } }
  })
  f.options.runtime.proxyRuntime = { ...f.options.runtime.proxyRuntime, getUnit }
  f.options.runtime.attributesOf = () => ({ path: '/wrong-again' })
  await accepted(await f.run(f.request({ events: [exposure] }, { referer: 'https://example.test/article//?campaign=autumn' })))
  expect(stored()).toHaveLength(1)
  expect(stored()[0]?.type).toBe('exposure')
})
test.each(['/', '/a', '/a/', '/a//'])('proxy and endpoint agree on path eligibility for %s', async pathname => {
  const f = fixture()
  // Try both possible target paths to check eligibility and rejection for each URL.
  for (const target of ['/', '/a']) {
    f.manifest.experiments[0]!.targeting = [{ attribute: 'path', type: 'string', op: 'eq', value: target }]
    const proxy = { ...f.options.runtime.proxyRuntime, getUnit: async () => ({ attributes: { path: '/spoof' } }) }
    f.options.runtime.proxyRuntime = proxy
    f.options.runtime.attributesOf = () => ({ path: '/also-spoof' })
    const url = `https://example.test${pathname}`
    const proxied = await resolveExperiments(new NextRequest(url, { headers: { cookie: `xp_id=${signed}` } }), proxy)
    const assignments = decodeAssignmentsHeader(proxied.requestHeaders.get('x-xp-assignments')!, { secrets, visitorId: 'visitor', manifest: f.manifest })!
    const assigned = assignments.bySlug['example-experiment']!
    const expected = target === (pathname === '/' ? '/' : '/a')
    expect(assigned.exposable).toBe(expected)
    insert.mockClear()
    await accepted(await f.run(f.request({ events: [{ ...exposure, arm: assigned.arm }] }, { referer: url })))
    expect(stored().length > 0).toBe(assigned.exposable)
  }
})
test.each([false, true])('unknown session with declared staff suppresses exposure and mismatch rows (authenticated=%s)', async authenticated => {
  const f = fixture()
  f.options.attributeKeys = { staff: { type: 'boolean' } }
  f.options.runtime.proxyRuntime = { ...f.options.runtime.proxyRuntime, getUnit: async () => ({ attributes: { staff: false }, sessionUnknown: true }) }
  await accepted(await f.run(f.request({ events: [exposure, { ...exposure, arm: 'control' }, conversion] }, {},
    { user: authenticated ? { id: 'user' } : undefined })))
  expect(stored().map(row => row.type)).toEqual(authenticated ? ['exposure', 'arm-mismatch', 'conversion'] : ['conversion'])
})
test('events endpoint and signedCookie wrapper both select the last signed unit cookie', async () => {
  const f = fixture()
  const cookie = `xp_id=${signed}; xp_id=${encodeUnitCookie('last', ['previous'])}`
  await accepted(await f.run(f.request(undefined, { cookie })))
  const endpoint = buildEndpoints({ options: f.options }).find(route => route.path === '/xp/events')!
  await accepted(await endpoint.handler(f.request(undefined, { cookie })))
  expect(stored()).toHaveLength(4)
  expect(stored().every(row => row.unitId === 'last')).toBe(true)
  const invalidLast = `xp_id=${signed}; xp_id=unsigned`
  expect((await f.run(f.request(undefined, { cookie: invalidLast }))).status).toBe(401)
  expect((await endpoint.handler(f.request(undefined, { cookie: invalidLast }))).status).toBe(401)
})
test.each([undefined, 'https://other.test/article', 'bad-url'])('missing or invalid page context never uses the API route or host-supplied path (%s)', async referer => {
  const f = fixture({ targeting: [{ attribute: 'path', type: 'string', op: 'eq', value: '/article' }] })
  f.options.runtime.attributesOf = () => ({ path: '/article' })
  await accepted(await f.run(f.request({ events: [exposure] }, referer ? { referer } : {})))
  expect(insert).not.toHaveBeenCalled()
})
test('never trusts inbound assignment or identity fields', async () => {
  const f = fixture()
  await accepted(await f.run(f.request({ events: [{ ...exposure, arm: 'control', unitId: 'forged' }, { ...conversion, userId: 'forged', value: 999 }] },
    { 'x-xp-assignments': 'unsigned-preview', 'x-xp-user': 'forged' })))
  expect(stored()).toMatchObject([{ type: 'arm-mismatch', unitId: 'visitor' }, { type: 'conversion', unitId: 'visitor', value: 1 }])
  expect(stored().every(row => row.userId === undefined)).toBe(true)
})
test.each(['private', 'revenue', 'unlisted'])('rejects %s conversion source', async mode => {
  const f = fixture()
  f.options.eventSources = []
  f.options.metricSources = mode === 'unlisted' ? [] : [{ id: 'registration', label: 'Registration', kind: mode === 'revenue' ? 'revenue' : 'count',
    keyedBy: 'visitor', clientWritable: mode === 'revenue', query: async () => [] }]
  await accepted(await f.run(f.request({ events: [conversion] })))
  expect(insert).not.toHaveBeenCalled()
})
test('server-only event conversions have the same silent response as unlisted names', async () => {
  const f = fixture()
  f.options.eventSources = [{ name: 'registration', clientWritable: false }]
  await accepted(await f.run(f.request({ events: [conversion] })))
  await accepted(await f.run(f.request({ events: [{ ...conversion, eventName: 'unlisted' }] })))
  expect(insert).not.toHaveBeenCalled()
})
test.each(['registration', { name: 'registration', clientWritable: true }])('permits writable event source %j', async entry => {
  const f = fixture()
  f.options.eventSources = resolveOptions({ ...f.options, eventSources: [entry] }).eventSources
  await accepted(await f.run(f.request({ events: [conversion] })))
  expect(stored()).toMatchObject([{ type: 'conversion', eventName: 'registration', value: 1 }])
  expect(insert).toHaveBeenCalledOnce()
})
test.each(['binomial', 'count'] as const)('permits clientWritable %s sources and stores 1', async kind => {
  const f = fixture()
  f.options.eventSources = []
  f.options.metricSources = [{ id: 'registration', label: 'Registration', kind, keyedBy: 'user', clientWritable: true, query: async () => [] }]
  await accepted(await f.run(f.request({ events: [{ ...conversion, value: 500 }] })))
  expect(stored()).toMatchObject([{ value: 1 }])
})
test.each(['', '   ', null, 5])('drops an empty or invalid idempotency key (%s)', async idempotencyKey => {
  const f = fixture()
  await accepted(await f.run(f.request({ events: [{ ...conversion, idempotencyKey }] })))
  expect(insert).not.toHaveBeenCalled()
})
test.each(['1e400', '-1e400', 'null', '"Infinity"'])('refuses non-finite or non-numeric wire values (%s)', async value => {
  const f = fixture()
  await accepted(await f.run(f.request(`{"events":[{"type":"conversion","eventName":"registration","idempotencyKey":"key","value":${value}}]}`, {}, { raw: true })))
  expect(insert).not.toHaveBeenCalled()
})
test('allow-lists attribute keys and declared primitive types', async () => {
  const f = fixture()
  const attributes = JSON.parse('{"campaign":"autumn","amount":2,"member":true,"email":"private","__proto__":"private","constructor":"private"}')
  await accepted(await f.run(f.request({ events: [{ ...conversion, attributes }, { ...conversion, idempotencyKey: 'second',
    attributes: { campaign: {}, amount: '2', member: [], other: false } }] })))
  expect(stored().map(row => row.attributes)).toEqual([{ campaign: 'autumn', amount: 2, member: true }, {}])
})
test('uses exposure and client-conversion namespaces and one batch on the pooled executor', async () => {
  const f = fixture()
  const req = f.request()
  req.transactionID = 'unrelated-transaction'
  await accepted(await f.run(req))
  expect(stored().map(row => row.dedupeKey)).toEqual(['exposure:42:1:variantA:visitor:2026-10-31', 'conversion:c:visitor:' + conversion.eventName + ':key'])
  expect(insert).toHaveBeenCalledOnce()
  const exec = insert.mock.calls[0]![0]
  await exec.query('SELECT 1')
  expect(f.execute).toHaveBeenCalledOnce()
})
test('null or failed manifest drops the whole request including conversions', async () => {
  const f = fixture()
  f.load.mockResolvedValue(null)
  await accepted(await f.run(f.request()))
  expect(insert).not.toHaveBeenCalled()
  f.options.runtime.proxyRuntime = { ...f.options.runtime.proxyRuntime, loadManifest: async () => { throw new Error('manifest down') } }
  await accepted(await f.run(f.request()))
  expect(insert).not.toHaveBeenCalled()
})
test('uses the runtime cache rather than loading for every beacon', async () => {
  const f = fixture()
  await accepted(await f.run(f.request()))
  await accepted(await f.run(f.request()))
  expect(f.load).toHaveBeenCalledOnce()
})
test('DB failures are logged and return exactly 202 {}, even if logging also fails', async () => {
  const f = fixture()
  insert.mockRejectedValueOnce(new Error('database down'))
  await accepted(await f.run(f.request()))
  expect(f.error).toHaveBeenCalledWith({ err: { name: 'Error', stack: expect.stringContaining('at ') } }, 'Experiments: events endpoint failed')
  f.error.mockImplementation(() => { throw new Error('logger down') })
  insert.mockRejectedValueOnce(new Error('database down'))
  await accepted(await f.run(f.request()))
})
test('individual unrecognized entries are dropped without rejecting a batch', async () => {
  const f = fixture()
  await accepted(await f.run(f.request({ events: [null, [], {}, { type: 'unknown' }, { ...exposure, phase: '1' }, conversion] })))
  expect(stored()).toHaveLength(1)
  expect(stored()[0]?.type).toBe('conversion')
})


test.each(['manual', 'viewport', 'pageview'] as const)('%s exposure freezes configured server dimensions and ignores body attributes', async policy => {
  const f = fixture({ exposurePolicy: policy })
  f.options.events = { dimensions: ['campaign', 'amount', 'loggedIn', 'path', 'object', 'array', 'nil', 'missing'] }
  f.options.runtime.proxyRuntime = { ...f.options.runtime.proxyRuntime, getUnit: async () => ({ attributes: {
    campaign: 's'.repeat(80), amount: 42, loggedIn: true, path: '/spoof', unconfigured: 'drop',
    object: { nested: true }, array: ['drop'], nil: null,
  } as unknown as Record<string, string | number | boolean> }) }
  const forged = { dimensions: { campaign: 'forged', missing: 'forged' }, attributes: { campaign: 'forged', missing: 'forged' }, campaign: 'forged', path: '/forged', loggedIn: true }
  await accepted(await f.run(f.request({ ...forged, events: [
    { ...exposure, policy, ...forged }, { ...conversion, ...forged }, { ...exposure, policy, arm: 'control', ...forged },
  ] }, { referer: 'https://example.test/article//?ignored=1' })))
  expect(stored().map(row => [row.type, row.dimensions])).toEqual([
    ['exposure', { campaign: 's'.repeat(64), amount: 42, loggedIn: false, path: '/article' }],
    ['conversion', null], ['arm-mismatch', null],
  ])
})

test.each([undefined, [], ['missing'], ['amount']].map(dimensions => ({ dimensions })))('empty dimension selection %j writes null', async ({ dimensions }) => {
  const f = fixture()
  f.options.events = { dimensions }
  f.options.runtime.proxyRuntime = { ...f.options.runtime.proxyRuntime, getUnit: async () => ({ attributes: { amount: Infinity } }) }
  await accepted(await f.run(f.request({ events: [{ ...exposure, dimensions: { amount: 1 }, attributes: { amount: 1 } }] })))
  expect(stored()).toMatchObject([{ type: 'exposure', dimensions: null }])
})
