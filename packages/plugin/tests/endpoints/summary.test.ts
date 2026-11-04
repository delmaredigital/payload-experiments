import { afterEach, expect, test, vi } from 'vitest'
import { newestSnapshotIds } from '../../src/db/snapshots.js'
import { defaultArms } from '../../src/collections/experiments/armInvariants.js'
import { buildEndpoints } from '../../src/endpoints/index.js'
import { handleSummary } from '../../src/endpoints/summary.js'
import { sanitizeReadinessDetail } from '../../src/endpoints/sanitizeReadinessDetail.js'
import { ARM_CHECK_ORDER, checkStart, type ReadinessCode } from '../../src/transitions/checkStart.js'
import { loadStartInputsBatch } from '../../src/transitions/preflightData.js'
import type { StartExperiment } from '../../src/transitions/checkStart.js'
import { fakePayload } from '../_fakes/payload.js'
import { fakeReq } from '../_fakes/req.js'
import { sampleOptions } from '../collections/fixtures.js'
import fixture from '../_fixtures/snapshots/T7.json'
const options = sampleOptions()
vi.mock('../../src/db/snapshots.js', async original => ({ ...await original<object>(), newestSnapshotIds: vi.fn() }))
afterEach(() => vi.resetAllMocks())

test('latest snapshot summaries preserve opaque encoded ids and return null verdict before first run', async () => {
  const id = 'opaque /%+é'
  vi.mocked(newestSnapshotIds).mockResolvedValue([2])
  const payload = fakePayload({ collections: { 'xp-results-snapshots': [
    { id: 1, experiment: id, phase: 1, computedAt: '2026-10-01T00:00:00Z', snapshot: { ...fixture, exposures: { total: 1 } } },
    { id: 2, experiment: id, phase: 1, computedAt: '2026-10-02T00:00:00Z', snapshot: fixture },
  ] } })
  const req = fakeReq({ payload, url: `http://localhost/summary?ids=${encodeURIComponent(id)},draft,__proto__` })
  const response = await handleSummary(req, { options })
  const body = await response.json()
  expect(body[id]).toEqual({ exposures: fixture.exposures.total,
    days: (Date.parse(fixture.window.to) - Date.parse(fixture.window.from)) / 86_400_000,
    verdict: { code: fixture.verdict.code, headline: fixture.verdict.headline } })
  expect(body.draft).toEqual({ exposures: 0, days: 0, verdict: null })
  expect(Object.hasOwn(body, '__proto__')).toBe(true)
  expect(payload.calls[0]!.args).toMatchObject({ req, overrideAccess: false, depth: 0 })
  expect(payload.calls[0]!.args).toMatchObject({ limit: 1, where: { id: { in: [2] } } })
  expect(newestSnapshotIds).toHaveBeenCalledWith(expect.anything(), [id, 'draft', '__proto__'], 'experiment')
})

test.each([
  ['', 400, 'invalid-body'], ['?ids=%E0%A4', 400, 'invalid-body'], ['?ids=', 422, 'invalid-ids'],
  [`?ids=${Array.from({ length: 101 }, (_, n) => n).join(',')}`, 422, 'too-many-ids'],
])('summary refuses %s with distinct parse/input codes', async (query, status, code) => {
  const req = fakeReq({ url: `http://localhost/summary${query}` })
  const response = await handleSummary(req, { options })
  expect(response.status).toBe(status)
  expect(await response.json()).toMatchObject({ errors: [{ code }] })
})

test('100 ids accepted, repeated ids deduplicated in the reader', async () => {
  const payload = fakePayload()
  vi.mocked(newestSnapshotIds).mockResolvedValue([])
  expect((await handleSummary(fakeReq({ payload, url: `http://localhost/summary?ids=${Array(100).fill('one').join(',')}` }), { options })).status).toBe(200)
  expect(newestSnapshotIds).toHaveBeenCalledWith(expect.anything(), ['one'], 'experiment')
  expect(payload.calls).toHaveLength(1)
  expect(payload.calls[0]!.args).toMatchObject({ collection: 'xp-experiments', overrideAccess: false, depth: 0, where: { id: { in: ['one'] } } })
})

function readinessSetup() {
  const options = sampleOptions()
  options.puck = { enabled: true, collections: ['pages'] }
  const placements = vi.fn(async () => [{ arm: 'control', ok: true }, { arm: 'variantA', ok: true }])
  options.flagPoints![0]!.placements = placements
  const findGlobal = vi.fn(async () => ({ flagDefaults: {} }))
  const draft = (id: string, kind: 'block' | 'flag' = 'block') => ({
    id, slug: id, kind, status: 'draft', unitType: 'visitor', allocation: 100,
    exposurePolicy: kind === 'block' ? 'render' : 'manual', flagPoint: kind === 'flag' ? 'cta' : undefined,
    arms: defaultArms(kind), analysis: { plannedDurationDays: 28, reachPerDay: 100 }, metrics: { primary: 2 },
  })
  const payload = fakePayload({ overrides: { findGlobal }, collections: {
    'xp-experiments': [draft('one'), draft('two'), draft('flag', 'flag')],
    'xp-metrics': [{ id: 2, source: 'binomial' }],
    pages: [{ id: 10, _status: 'published', puckData: { content: ['one', 'two'].map(experiment => ({
      type: 'ExperimentSlot', props: { experiment, control: [{}], variantA: [{}] },
    })) } }],
  } })
  vi.mocked(newestSnapshotIds).mockResolvedValue([])
  const req = fakeReq({ payload, user: { id: 1 }, url: 'http://localhost/summary?ids=one,two,flag' })
  return { options, payload, req, placements, findGlobal }
}

test('two block drafts share one scan; a flag draft shares metrics and state and all three are ready', async () => {
  const { options, req, payload, placements, findGlobal } = readinessSetup()
  const response = await handleSummary(req, { options })
  expect(response.status).toBe(200)
  const body = await response.json()
  expect([body.one.ready, body.two.ready, body.flag.ready]).toEqual([true, true, true])
  for (const row of Object.values(body)) expect(row).not.toHaveProperty('next')
  // One scan means one published read and one draft read, independent of slug count.
  expect(payload.calls.filter(call => call.args.collection === 'pages')).toHaveLength(2)
  expect(payload.calls.filter(call => call.args.collection === 'xp-metrics')).toHaveLength(1)
  expect(payload.calls.filter(call => call.args.collection === 'xp-experiments')).toHaveLength(2) // ids + flag occupancy
  expect(findGlobal).toHaveBeenCalledTimes(1)
  expect(placements).toHaveBeenCalledTimes(1)
  expect(payload.calls).toHaveLength(5)
  expect(payload.calls.every(call => call.args.req === req && call.args.overrideAccess === false && call.args.depth === 0)).toBe(true)
  expect(findGlobal).toHaveBeenCalledWith({ slug: 'xp-state', req, overrideAccess: false, depth: 0 })
})

test('a missing primary goal gives false readiness; stopped is checked and running omits the key', async () => {
  const { options, req, payload } = readinessSetup()
  payload.documents['xp-experiments']![0]!.metrics = {}
  payload.documents['xp-experiments']![1]!.status = 'stopped'
  payload.documents['xp-experiments']![2]!.status = 'running'
  const body = await (await handleSummary(req, { options })).json()
  expect(body.one.ready).toBe(false)
  expect(body.one.next).toEqual({ code: 'no-primary-metric' })
  expect(body.two.ready).toBe(true)
  expect(body.two).not.toHaveProperty('next')
  expect(body.flag).not.toHaveProperty('ready')
  expect(body.flag).not.toHaveProperty('next')
})

test('readResults-only callers get no readiness and perform no setup reads', async () => {
  const { options, req, payload, findGlobal, placements } = readinessSetup()
  options.access = { manage: () => false, readResults: () => true }
  const route = buildEndpoints({ options }).find(route => route.path === '/xp/experiments/summary')!
  const body = await (await route.handler(req)).json()
  for (const row of Object.values(body)) {
    expect(row).not.toHaveProperty('ready')
    expect(row).not.toHaveProperty('next')
  }
  expect(payload.calls).toEqual([])
  expect(findGlobal).not.toHaveBeenCalled()
  expect(placements).not.toHaveBeenCalled()
})

test('a throwing host manage callback preserves verdicts for readResults-only callers', async () => {
  const { options, req, payload } = readinessSetup()
  options.access = { manage: () => { throw new Error('host manage unavailable') }, readResults: () => true }
  vi.mocked(newestSnapshotIds).mockResolvedValue([1])
  payload.documents['xp-results-snapshots'] = [{ id: 1, experiment: 'one', snapshot: fixture }]
  const route = buildEndpoints({ options }).find(route => route.path === '/xp/experiments/summary')!
  const response = await route.handler(req)
  expect(response.status).toBe(200)
  const body = await response.json()
  expect(body.one).toEqual({ exposures: fixture.exposures.total,
    days: (Date.parse(fixture.window.to) - Date.parse(fixture.window.from)) / 86_400_000,
    verdict: { code: fixture.verdict.code, headline: fixture.verdict.headline } })
  for (const row of Object.values(body)) expect(row).not.toHaveProperty('ready')
  expect(payload.calls.some(call => call.args.collection === 'xp-experiments')).toBe(false)
})

test('a failing ids find for a manager omits readiness without failing the summary', async () => {
  const { options, req, payload } = readinessSetup()
  const original = payload.find
  vi.spyOn(payload, 'find').mockImplementation(async args => {
    if (args.collection === 'xp-experiments') throw new Error('ids unavailable')
    return original(args)
  })
  const response = await handleSummary(req, { options })
  expect(response.status).toBe(200)
  const body = await response.json()
  for (const row of Object.values(body)) expect(row).toEqual({ exposures: 0, days: 0, verdict: null })
  expect(Object.keys(body)).toEqual(['one', 'two', 'flag'])
})

test('placement and per-experiment read failures return false without failing healthy peers', async () => {
  const { options, req, payload, placements } = readinessSetup()
  placements.mockRejectedValue(new Error('host unavailable'))
  payload.documents['xp-experiments']![0]!.layer = 9
  const original = payload.find
  vi.spyOn(payload, 'find').mockImplementation(async args => {
    if (args.collection === 'xp-layers') throw new Error('layer unavailable')
    return original(args)
  })
  const response = await handleSummary(req, { options })
  expect(response.status).toBe(200)
  const body = await response.json()
  expect([body.one.ready, body.two.ready, body.flag.ready]).toEqual([false, true, false])
})

test('drafts on the same flag point and layer share occupancy and layer reads', async () => {
  const { options, req, payload, placements, findGlobal } = readinessSetup()
  const flag = payload.documents['xp-experiments']![2]!
  payload.documents['xp-experiments'] = ['one', 'two', 'flag'].map(id => ({ ...flag, id, slug: id, layer: 9 }))
  payload.documents['xp-layers'] = [{ id: 9, unitType: 'visitor' }]
  const body = await (await handleSummary(req, { options })).json()
  expect([body.one.ready, body.two.ready, body.flag.ready]).toEqual([true, true, true])
  expect(payload.calls.filter(call => call.args.collection === 'xp-experiments')).toHaveLength(3) // ids, flag occupancy, layer usage
  expect(payload.calls.filter(call => call.args.collection === 'xp-layers')).toHaveLength(1)
  expect(findGlobal).toHaveBeenCalledTimes(1)
  expect(placements).toHaveBeenCalledTimes(3)
})


test('readiness preserves raw response keys when Payload normalises a numeric id', async () => {
  const { options, payload } = readinessSetup()
  const req = fakeReq({ payload, user: { id: 1 }, url: 'http://localhost/summary?ids=01' })
  Object.assign(payload.db, { defaultIDType: 'number' })
  const experiment = { ...payload.documents['xp-experiments']![0]!, id: 1 }
  const original = payload.find
  vi.spyOn(payload, 'find').mockImplementation(async args => {
    const result = await original(args)
    if (args.collection === 'xp-experiments') return { ...result, docs: [experiment] }
    return result
  })
  const response = await handleSummary(req, { options })
  expect(response.status).toBe(200)
  const body = await response.json()
  expect(body['01'].ready).toBe(true)
  expect(body).not.toHaveProperty('1')
})

test.each(['?ids=2%2C1', '?ids=2&ids=1', '?ids=+2+%2C%2C+1+,'])('summary parses and coerces numeric ids from %s', async query => {
  const payload = fakePayload({ collections: { 'xp-results-snapshots': [
    { id: 3, experiment: 2, computedAt: '2026-10-02T00:00:00Z', snapshot: fixture },
  ] } })
  Object.assign(payload.db, { defaultIDType: 'number' })
  vi.mocked(newestSnapshotIds).mockResolvedValue([3])
  const response = await handleSummary(fakeReq({ payload, url: `http://localhost/summary${query}` }), { options })
  expect(response.status).toBe(200)
  const body = await response.json()
  expect(Object.keys(body).sort()).toEqual(['1', '2'])
  expect(body['2'].exposures).toBe(fixture.exposures.total)
  expect(body['1'].verdict).toBeNull()
  expect(newestSnapshotIds).toHaveBeenCalledWith(expect.anything(), [2, 1], 'experiment')
  expect(payload.calls.find(call => call.args.collection === 'xp-experiments')?.args).toMatchObject({ where: { id: { in: [2, 1] } } })
})

test('numeric summary drops nonnumeric ids and preserves requested keys for snapshots', async () => {
  const payload = fakePayload({ collections: { 'xp-results-snapshots': [
    { id: 3, experiment: 1, computedAt: '2026-10-02T00:00:00Z', snapshot: fixture },
  ] } })
  Object.assign(payload.db, { defaultIDType: 'number' })
  vi.mocked(newestSnapshotIds).mockResolvedValue([3])
  const response = await handleSummary(fakeReq({ payload, url: 'http://localhost/summary?ids=abc,01,1' }), { options })
  const body = await response.json()
  expect(Object.keys(body).sort()).toEqual(['01', '1'])
  expect(body['01'].exposures).toBe(fixture.exposures.total)
  expect(body['01']).toEqual(body['1'])
  expect(newestSnapshotIds).toHaveBeenCalledWith(expect.anything(), [1], 'experiment')
})

test('entirely nonnumeric summary on a numeric host is empty without database reads', async () => {
  const payload = fakePayload()
  Object.assign(payload.db, { defaultIDType: 'number' })
  expect(await (await handleSummary(fakeReq({ payload, url: 'http://localhost/summary?ids=abc' }), { options })).json()).toEqual({})
  expect(payload.calls).toEqual([])
  expect(newestSnapshotIds).not.toHaveBeenCalled()
})

test('summary carries bounded page health without copying arbitrary detail', async () => {
  vi.mocked(newestSnapshotIds).mockResolvedValue([1])
  const payload = fakePayload({ collections: { 'xp-results-snapshots': [{ id: 1, experiment: 'page', snapshot: { ...fixture,
    health: Array.from({ length: 101 }, () => ({ code: 'version-page-unavailable', path: '/' + 'a'.repeat(600), secret: 'secret-value' })),
  } }] } })
  const body = await (await handleSummary(fakeReq({ payload, url: 'http://localhost/summary?ids=page' }), { options })).json()
  expect(body.page.health).toHaveLength(100)
  expect(body.page.health[0]).toEqual({ code: 'version-page-unavailable', path: '/' + 'a'.repeat(127) })
  expect(JSON.stringify(body)).not.toContain('secret-value')
})

test('next is the first failure in the actual checkStart order, not the last', async () => {
  const { options, req, payload } = readinessSetup()
  const draft = payload.documents['xp-experiments']![0]!
  draft.arms = [...defaultArms('block')].reverse().map(arm => ({ ...arm, weight: 10 }))
  draft.analysis = {}
  draft.metrics = {}
  const inputs = await loadStartInputsBatch(req, options, [draft as unknown as StartExperiment])
  const checks = checkStart(inputs.get('one')!)
  expect(checks.slice(1, 1 + ARM_CHECK_ORDER.length).map(check => check.code)).toEqual(ARM_CHECK_ORDER)
  const failures = checks.filter(check => !check.ok && !check.warning)
  expect(failures.length).toBeGreaterThan(2)
  expect(failures[0]!.code).toBe('weights-total')
  const body = await (await handleSummary(req, { options })).json()
  expect(body.one).toMatchObject({ ready: false, next: { code: failures[0]!.code } })
  expect(body.one.next).not.toHaveProperty('detail') // Invariant messages are text.
})

test.each(['running', 'decided', 'archived'])('%s tests never receive next or ready', async status => {
  const { options, req, payload } = readinessSetup()
  Object.assign(payload.documents['xp-experiments']![0]!, { status, metrics: {} })
  const body = await (await handleSummary(req, { options })).json()
  expect(body.one).not.toHaveProperty('next')
  expect(body.one).not.toHaveProperty('ready')
})

test('a stopped test receives its first failing step', async () => {
  const { options, req, payload } = readinessSetup()
  Object.assign(payload.documents['xp-experiments']![0]!, { status: 'stopped', metrics: {} })
  const body = await (await handleSummary(req, { options })).json()
  expect(body.one).toMatchObject({ ready: false, next: { code: 'no-primary-metric' } })
})

test('a warning-only page check does not produce next', async () => {
  const { options, req, payload } = readinessSetup()
  const draft = payload.documents['xp-experiments']![0]!
  Object.assign(draft, { kind: 'page', exposurePolicy: 'pageview',
    arms: defaultArms('page').map(arm => ({ ...arm, pageTarget: `/${arm.key}` })) })
  const inputs = await loadStartInputsBatch(req, options, [draft as unknown as StartExperiment])
  expect(checkStart(inputs.get('one')!)).toContainEqual({ code: 'page-targets-unchecked', ok: true, warning: true })
  const body = await (await handleSummary(req, { options })).json()
  expect(body.one.ready).toBe(true)
  expect(body.one).not.toHaveProperty('next')
})

test('summary JSON never includes placement titles or flag placement free text', async () => {
  const { options, req, payload, placements } = readinessSetup()
  const secret = 'secret-value from a host error or page title'
  payload.documents.pages = [{ id: 10, title: secret, _status: 'published', puckData: { content: [{
    type: 'ExperimentSlot', props: { experiment: 'one', control: [{}], variantA: [] },
  }] } }]
  placements.mockImplementation(async () => [{ arm: 'control', ok: false, detail: secret }, { arm: 'variantA', ok: true }])
  const body = await (await handleSummary(req, { options })).json()
  expect(body.one.next).toEqual({ code: 'empty-slot' })
  expect(body.flag.next).toEqual({ code: 'flag-placement-missing', detail: { missing: ['control'], placements: [{ arm: 'control' }] } })
  expect(JSON.stringify(body)).not.toContain('secret-value')
})

const safeDetails: Array<[ReadinessCode, unknown, unknown]> = [
  ['no-placements', 'forbidden', 'forbidden'],
  ['page-target-unpublished', '/registration/thank-you', '/registration/thank-you'],
  ['flag-params-invalid', [{ arm: 'variantA', field: 'title', message: 'secret-value text' }], [{ arm: 'variantA', field: 'title' }]],
  ['flag-placement-missing', 'placements-failed', 'placements-failed'],
  ['flag-placement-missing', { missing: ['variantA'], placements: [{ arm: 'variantA', ok: false, detail: 'secret-value text' }], message: 'secret-value text' }, { missing: ['variantA'], placements: [{ arm: 'variantA' }] }],
  ['undeclared-targeting-key', { attributes: ['country', 'utmSource'], message: 'secret-value text' }, { attributes: ['country', 'utmSource'] }],
  ['invalid-targeting-rule', { attributes: ['country'], value: 'secret-value text' }, { attributes: ['country'] }],
]
test.each(safeDetails)('sanitizer allow-list for %s projects identifiers only', (code, detail, expected) => {
  expect(sanitizeReadinessDetail(code, detail)).toEqual(expected)
})

const unsafeDetails: Array<[ReadinessCode, unknown]> = [
  ['no-placements', 'secret-value text'],
  ['page-target-unpublished', '/secret-value text'],
  ['page-target-unpublished', '/page\n'],
  ['page-target-unpublished', '/page\r'],
  ['page-target-unpublished', '/page//child'],
  ['page-target-unpublished', '/page?secret-value=text'],
  ['page-target-unpublished', '//secret-value'],
  ['page-target-unpublished', '/page%20secret-value'],
  ['page-target-unpublished', `/${'a'.repeat(128)}`],
  ['flag-params-invalid', [{ arm: 'variantA', field: 'secret-value text' }]],
  ['flag-params-invalid', [{ arm: 'variantA', field: 'title\n' }]],
  ['flag-params-invalid', [{ arm: 'variantA', field: 'a'.repeat(129) }]],
  ['flag-params-invalid', [{ arm: 'unknown', field: 'title' }]],
  ['flag-params-invalid', { arm: 'variantA', field: 'title' }],
  ['flag-placement-missing', 'secret-value text'],
  ['flag-placement-missing', { missing: ['secret-value text'], placements: [] }],
  ['flag-placement-missing', { missing: [], placements: [{ detail: 'secret-value text' }] }],
  ['flag-placement-missing', { missing: [], placements: 'secret-value text' }],
  ['undeclared-targeting-key', { attributes: ['secret-value text'] }],
  ['invalid-targeting-rule', { attributes: ['a'.repeat(129)] }],
  ['invalid-targeting-rule', { message: 'secret-value text' }],
  ['empty-slot', [{ collection: 'pages', id: 10, title: 'secret-value text', slots: { control: 1, variantA: 0 } }]],
  ['unknown-metric-source', [{ id: 2, source: 'secret-value text' }]],
  ['layer-full', { available: 0, requested: 100 }],
]
test.each(unsafeDetails)('sanitizer drops unknown or non-identifier detail for %s', (code, detail) => {
  expect(sanitizeReadinessDetail(code, detail)).toBeUndefined()
})

test('sanitizer accepts identifiers and paths up to 128 characters and drops absent details', () => {
  const field = 'a'.repeat(128)
  expect(sanitizeReadinessDetail('flag-params-invalid', [{ arm: 'control', field }])).toEqual([{ arm: 'control', field }])
  const path = `/${'a'.repeat(127)}`
  expect(sanitizeReadinessDetail('page-target-unpublished', path)).toBe(path)
  for (const [code] of safeDetails) {
    for (const detail of [undefined, null, 123, true, [], {}]) expect(sanitizeReadinessDetail(code, detail)).toBeUndefined()
  }
})
